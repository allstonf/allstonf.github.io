"""Tests for build/build.py, the zero-dependency static-site generator.

These tests exercise the correctness requirements called out in the
rebuild spec: HTML/attribute escaping of hostile content, JSON-LD
round-tripping through json.loads (including a </script> breakout
guard), detection of unresolved template placeholders, byte-identical
reproducible builds, the no-em-dash style rule, and that every
generated artifact is well-formed in its own format (XML for the
sitemap, JSON for the API projection).

Tests build against the REAL templates/ directory checked into this
repo (templates/index.html + templates/project-card.html), but use a
synthetic, minimal profile dict for most cases so each test is
self-contained and does not depend on the real content/profile.json
staying byte-for-byte the same. A couple of tests that check specific
public-facing copy (the Apple guidance string) do read the real
content/profile.json, since that copy is itself the thing under test.
"""

import json
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

# The build/ directory itself is on sys.path when this file is run via
# `python3 -m unittest discover -s build`, so `import build` resolves to
# build/build.py (the module under test), not the build/ directory.
import build

REPO_ROOT = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = REPO_ROOT / "templates"


def make_minimal_profile(**overrides):
    """Return a minimal, schema-shaped profile dict for isolated tests.

    Mirrors the top-level keys of content/profile.json (site, person,
    about, projects, experience, agent_surface, _meta) with the
    smallest values that let generate_artifacts() run end to end.
    `overrides` lets a test replace one field to inject hostile input
    without duplicating the whole fixture.
    """
    profile = {
        "_meta": {"last_updated": "2026-07-25"},
        "site": {
            "url": "https://allstonf.github.io",
            "title": "Test Site",
            "description": "A test description.",
            "locale": "en-US",
            "theme_color": "#0B0C0E",
        },
        "person": {
            "name": "Test Person",
            "headline": "Test Headline",
            "tagline": "Test tagline.",
            "location": "Somewhere",
            "email": "test@example.com",
            "current_role": {
                "title": "Test Title",
                "employer": "Apple",
                "employer_url": "https://www.apple.com",
                "start": "2022-07",
                "location": "Cupertino, CA",
            },
            "education": {
                "institution": "Test University",
                "institution_url": "https://example.edu",
                "credential": "B.S. Testing",
                "detail": "Test cohort",
            },
            "knows_about": ["Testing"],
            "profiles": [
                {"label": "GitHub", "url": "https://github.com/test", "handle": "test"},
            ],
            "resume": {
                "url": "https://example.com/resume.pdf",
                "label": "Resume",
                "note": "internal-only note that must never render publicly",
            },
        },
        "about": ["A test paragraph."],
        "projects": [
            {
                "slug": "test-project",
                "name": "Test Project",
                "featured": True,
                "summary": "A test project summary.",
                "outcome": None,
                "bullets": ["A bullet."],
                "stack": ["Python"],
                "links": [{"label": "Source", "url": "https://example.com/src"}],
            },
        ],
        "experience": [
            {
                "employer": "Apple",
                "title": "Test Title",
                "start": "2022-07",
                "end": None,
                "location": "Cupertino, CA",
                "bullets": ["A test bullet."],
            },
        ],
        "agent_surface": {
            "llms_txt_intro": "Test intro.",
            "llms_txt_guidance": "Test guidance mentioning Apple.",
            "crawler_policy": "welcome",
        },
    }
    profile.update(overrides)
    return profile


class HtmlEscapingTests(unittest.TestCase):
    """Every value interpolated into HTML must be escaped (Requirement 1)."""

    def test_hostile_project_name_is_escaped_not_executed(self):
        """A project name containing <script> and a quote must not break
        out of its HTML context in the rendered index.html."""
        profile = make_minimal_profile()
        profile["projects"][0]["name"] = '<script>alert("xss")</script>'
        artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
        index_html = artifacts["index.html"]
        # The raw, unescaped tag must never appear in the output.
        self.assertNotIn('<script>alert("xss")</script>', index_html)
        # The escaped form must appear somewhere (proving the value made
        # it into the page, just safely).
        self.assertIn("&lt;script&gt;", index_html)

    def test_hostile_bullet_text_is_escaped(self):
        """Ampersands and angle brackets in a bullet string are escaped."""
        profile = make_minimal_profile()
        profile["experience"][0]["bullets"] = ["Cut costs by 10% using <b>bold</b> & such"]
        artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
        self.assertNotIn("<b>bold</b>", artifacts["index.html"])
        self.assertIn("&lt;b&gt;bold&lt;/b&gt;", artifacts["index.html"])


class AttributeEscapingTests(unittest.TestCase):
    """URLs interpolated into href must be escaped for attribute context
    (Requirement 2)."""

    def test_hostile_url_cannot_break_out_of_href_attribute(self):
        """A link URL containing a double quote must not terminate the
        href="..." attribute early and inject a new attribute/tag."""
        profile = make_minimal_profile()
        hostile_url = 'https://example.com/"><script>alert(1)</script>'
        profile["projects"][0]["links"] = [{"label": "Source", "url": hostile_url}]
        artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
        index_html = artifacts["index.html"]
        self.assertNotIn('href="https://example.com/"><script>', index_html)
        # The quote inside the URL must be entity-encoded.
        self.assertIn("&quot;&gt;&lt;script&gt;", index_html)


class JsonLdTests(unittest.TestCase):
    """JSON-LD must be generated via json.dumps and survive a json.loads
    round-trip (Requirement 3), including a </script> breakout guard."""

    def _extract_json_ld_text(self, index_html):
        """Pull the raw text between the ld+json <script> tags."""
        start_tag = '<script type="application/ld+json">'
        start = index_html.index(start_tag) + len(start_tag)
        end = index_html.index("</script>", start)
        return index_html[start:end]

    def test_json_ld_round_trips_and_has_expected_person_fields(self):
        """The ld+json block must parse as JSON and contain the required
        schema.org Person fields, with worksFor naming Apple."""
        profile = make_minimal_profile()
        artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
        raw = self._extract_json_ld_text(artifacts["index.html"])
        data = json.loads(raw)
        self.assertEqual(data["@type"], "Person")
        self.assertEqual(data["name"], "Test Person")
        self.assertEqual(data["jobTitle"], "Test Title")
        self.assertEqual(data["worksFor"]["name"], "Apple")
        self.assertIn("knowsAbout", data)
        self.assertIn("sameAs", data)
        self.assertEqual(data["sameAs"], ["https://github.com/test"])

    def test_json_ld_escapes_script_breakout_and_still_round_trips(self):
        """A knows_about entry containing a literal '</script>' must not
        terminate the JSON-LD <script> block early, and json.loads must
        still recover the original string exactly."""
        profile = make_minimal_profile()
        profile["person"]["knows_about"] = ["</script><script>alert(1)</script>"]
        artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
        index_html = artifacts["index.html"]
        # The literal breakout sequence must not appear verbatim inside
        # the ld+json script body (it would close the tag early).
        raw = self._extract_json_ld_text(index_html)
        self.assertNotIn("</script>", raw)
        data = json.loads(raw)
        self.assertEqual(data["knowsAbout"], ["</script><script>alert(1)</script>"])


class UnresolvedPlaceholderTests(unittest.TestCase):
    """A missing template key must not raise (safe_substitute), but an
    explicit check must catch any leftover ${...} token and the build
    must exit non-zero (Requirement 4)."""

    def test_find_unresolved_placeholders_detects_leftover_token(self):
        """find_unresolved_placeholders() must report a ${...} token that
        was never substituted."""
        text = "<p>Hello ${missing_key}, welcome to ${site_title}.</p>"
        found = build.find_unresolved_placeholders(text)
        self.assertIn("${missing_key}", found)
        self.assertIn("${site_title}", found)

    def test_find_unresolved_placeholders_returns_empty_for_clean_text(self):
        """No false positives on ordinary rendered text."""
        text = "<p>Hello world, this costs $5 today.</p>"
        self.assertEqual(build.find_unresolved_placeholders(text), [])

    def test_generate_artifacts_raises_on_broken_template(self):
        """A template containing a placeholder no mapping key can fill
        (e.g. a typo) must raise BuildError from generate_artifacts, so
        main() can turn that into a non-zero exit rather than shipping a
        page with a literal ${...} token on it."""
        import tempfile

        profile = make_minimal_profile()
        with tempfile.TemporaryDirectory() as tmp:
            tmp_templates = Path(tmp)
            # Copy the real project-card template as-is.
            (tmp_templates / "project-card.html").write_text(
                (TEMPLATES_DIR / "project-card.html").read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            # Corrupt index.html with a placeholder that will never be
            # in the substitution mapping.
            real_index = (TEMPLATES_DIR / "index.html").read_text(encoding="utf-8")
            broken_index = real_index + "\n<!-- ${this_key_will_never_exist} -->\n"
            (tmp_templates / "index.html").write_text(broken_index, encoding="utf-8")

            with self.assertRaises(build.BuildError):
                build.generate_artifacts(profile, tmp_templates)

    def test_cli_exits_non_zero_when_a_placeholder_is_left_unresolved(self):
        """End-to-end: running build.py against a repo copy with a broken
        template must exit non-zero, per Requirement 4's explicit ask
        that the build script itself (not just a helper function) fails
        loudly."""
        import shutil
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            # Mirror the real repo layout exactly: build.py lives one
            # level BELOW repo root, in a build/ subdirectory, so
            # build.py's own repo-root resolution (parent.parent of its
            # own file path) finds content/ and templates/ as siblings
            # of build/, not siblings of build.py itself.
            tmp_repo = Path(tmp) / "repo"
            shutil.copytree(REPO_ROOT / "content", tmp_repo / "content")
            shutil.copytree(REPO_ROOT / "templates", tmp_repo / "templates")
            (tmp_repo / "build").mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO_ROOT / "build" / "build.py", tmp_repo / "build" / "build.py")
            # Break the copied template.
            broken = (tmp_repo / "templates" / "index.html").read_text(encoding="utf-8")
            broken += "\n<!-- ${this_key_will_never_exist} -->\n"
            (tmp_repo / "templates" / "index.html").write_text(broken, encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(tmp_repo / "build" / "build.py")],
                cwd=tmp_repo,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)


class ReproducibilityTests(unittest.TestCase):
    """Two consecutive builds from unchanged input produce byte-identical
    output (Requirement 5)."""

    def test_two_builds_are_byte_identical(self):
        """Generating artifacts twice from the same profile must produce
        exactly equal strings for every artifact."""
        profile = make_minimal_profile()
        first = build.generate_artifacts(profile, TEMPLATES_DIR)
        second = build.generate_artifacts(profile, TEMPLATES_DIR)
        self.assertEqual(first, second)


class NoEmDashTests(unittest.TestCase):
    """No U+2014 em-dash characters in generated output (Requirement 6),
    a hard style rule from the repo owner."""

    def test_index_html_has_no_em_dash(self):
        """The rendered index.html must not contain U+2014."""
        profile = build.load_profile(REPO_ROOT / "content" / "profile.json")
        artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
        self.assertNotIn("\u2014", artifacts["index.html"])

    def test_llms_txt_has_no_em_dash(self):
        """The rendered llms.txt must not contain U+2014."""
        profile = build.load_profile(REPO_ROOT / "content" / "profile.json")
        artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
        self.assertNotIn("\u2014", artifacts["llms.txt"])


class SitemapTests(unittest.TestCase):
    """sitemap.xml must be valid XML per xml.etree.ElementTree
    (Requirement/test list item)."""

    def test_sitemap_parses_as_valid_xml_with_expected_urls(self):
        """The sitemap must parse and contain exactly the three expected
        URLs, with lastmod pinned to _meta.last_updated (not the clock)."""
        profile = make_minimal_profile()
        artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
        root = ET.fromstring(artifacts["sitemap.xml"])
        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        locs = [el.text for el in root.findall("sm:url/sm:loc", ns)]
        self.assertEqual(
            set(locs),
            {
                "https://allstonf.github.io/",
                "https://allstonf.github.io/llms.txt",
                "https://allstonf.github.io/api/profile.json",
            },
        )
        lastmods = {el.text for el in root.findall("sm:url/sm:lastmod", ns)}
        # lastmod must come from _meta.last_updated, reproducibly, not
        # datetime.now() -- otherwise two builds a day apart would not
        # be byte-identical, violating Requirement 5.
        self.assertEqual(lastmods, {"2026-07-25"})


class LlmsTxtTests(unittest.TestCase):
    """llms.txt must contain the Apple current-role guidance string."""

    def test_llms_txt_contains_apple_current_role_guidance(self):
        """Reads the REAL profile.json since this checks actual public
        copy, not a synthetic fixture."""
        profile = build.load_profile(REPO_ROOT / "content" / "profile.json")
        artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
        self.assertIn(
            profile["agent_surface"]["llms_txt_guidance"], artifacts["llms.txt"]
        )
        self.assertIn("Apple", artifacts["llms.txt"])


class ApiProfileTests(unittest.TestCase):
    """api/profile.json must parse as JSON and project the content model
    (Requirement/test list item)."""

    def test_api_profile_json_parses_and_has_expected_shape(self):
        """The machine surface must include person/about/projects/experience."""
        profile = make_minimal_profile()
        artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
        data = json.loads(artifacts["api/profile.json"])
        for key in ("person", "about", "projects", "experience"):
            self.assertIn(key, data)
        self.assertEqual(data["person"]["name"], "Test Person")


class RobotsTxtTests(unittest.TestCase):
    """robots.txt must explicitly welcome AI crawlers and point at the
    sitemap plus llms.txt."""

    def test_robots_txt_welcomes_named_agent_crawlers(self):
        """GPTBot, ClaudeBot, PerplexityBot, Google-Extended must each get
        an explicit Allow: / and the sitemap + llms.txt must be linked."""
        profile = make_minimal_profile()
        artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
        robots = artifacts["robots.txt"]
        for bot in ("GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"):
            self.assertIn(bot, robots)
        self.assertIn("Allow: /", robots)
        self.assertIn("sitemap.xml", robots)
        self.assertIn("llms.txt", robots)


class CheckFlagTests(unittest.TestCase):
    """--check builds to a temp dir and diffs against committed artifacts,
    exiting non-zero if they differ (Requirement 7)."""

    def test_check_flag_exits_zero_immediately_after_a_build(self):
        """Running `python3 build/build.py` then `--check` in the real
        repo must succeed both times -- this doubles as an end-to-end
        smoke test of the whole pipeline."""
        build_result = subprocess.run(
            [sys.executable, str(REPO_ROOT / "build" / "build.py")],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(build_result.returncode, 0, build_result.stderr)

        check_result = subprocess.run(
            [sys.executable, str(REPO_ROOT / "build" / "build.py"), "--check"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(check_result.returncode, 0, check_result.stderr)

    def test_check_flag_exits_non_zero_when_a_committed_artifact_is_stale(self):
        """If a committed artifact drifts from what the generator would
        produce, --check must catch it and exit non-zero."""
        # Ensure committed artifacts are fresh first.
        subprocess.run(
            [sys.executable, str(REPO_ROOT / "build" / "build.py")],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        sitemap_path = REPO_ROOT / "sitemap.xml"
        original = sitemap_path.read_text(encoding="utf-8")
        try:
            sitemap_path.write_text(original + "\n<!-- stale -->\n", encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(REPO_ROOT / "build" / "build.py"), "--check"],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
        finally:
            # Restore, then rebuild for real so the working tree is clean
            # for the commit at the end of this task.
            sitemap_path.write_text(original, encoding="utf-8")
            subprocess.run(
                [sys.executable, str(REPO_ROOT / "build" / "build.py")],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                check=True,
            )

class InternalFieldLeakTests(unittest.TestCase):
    """Public artifacts publish an explicit ALLOWLIST of fields, nothing more.

    The content model is hand-edited, so a field can be added to it for
    local or editorial reasons with no intent to publish that field. A
    whole-subtree passthrough into a public artifact therefore fails
    OPEN: whatever is added next publishes itself.

    These tests pin the fail-CLOSED direction instead: a field is
    invisible to the public surfaces until it is explicitly opted in.
    An over-strict allowlist drops a field from a page, which is
    recoverable. A permissive one publishes something that was never
    meant to ship, which is not.

    Note that these tests are themselves published, so they assert on
    structural FIELD NAMES and synthetic canaries rather than quoting
    any real withheld text. A public test that spells out the exact
    phrases it scrubs would defeat the point of scrubbing them.
    """

    def test_api_profile_omits_internal_resume_note(self):
        """An editorial note on the resume field is not public copy.

        Regression: a free-text note attached to person.resume was
        served verbatim in api/profile.json before the allowlist landed.
        """
        rendered = json.loads(build.render_api_profile(make_minimal_profile()))
        self.assertNotIn("note", rendered["person"]["resume"])
        self.assertIn("url", rendered["person"]["resume"])

    def test_api_profile_omits_project_visibility_note(self):
        """A per-project visibility note must not reach a public artifact.

        Regression: this field carries the reason a project is presented
        the way it is, which is editorial context and not something to
        publish alongside the project itself.
        """
        profile = make_minimal_profile()
        canary = "CANARY-EDITORIAL-NOTE"
        profile["projects"][0]["visibility_note"] = canary
        rendered = json.loads(build.render_api_profile(profile))
        for project in rendered["projects"]:
            self.assertNotIn("visibility_note", project)
        self.assertNotIn(canary, build.render_api_profile(profile))

    def test_api_profile_publishes_only_allowlisted_fields(self):
        """Unknown fields are excluded by default, at every nesting depth.

        This is the property test that kills the whole class of bug
        rather than the two known instances. If someone adds a new
        internal field to the content model next month, it must not
        appear in a public artifact without an explicit opt-in.
        """
        profile = make_minimal_profile()
        canary = "CANARY-INTERNAL-DO-NOT-PUBLISH"
        profile["person"]["internal_todo"] = canary
        profile["person"]["resume"]["internal_flag"] = canary
        profile["person"]["current_role"]["internal_comment"] = canary
        profile["projects"][0]["internal_review"] = canary
        profile["experience"][0]["internal_comment"] = canary

        self.assertNotIn(canary, build.render_api_profile(profile))

    def test_no_internal_field_reaches_any_public_artifact(self):
        """The same canary must not surface in index.html or llms.txt either.

        api/profile.json was the leaking artifact, but the guarantee has
        to hold across every file the build publishes, not just the one
        where the bug was found.
        """
        profile = make_minimal_profile()
        canary = "CANARY-INTERNAL-DO-NOT-PUBLISH"
        profile["person"]["internal_todo"] = canary
        profile["person"]["resume"]["internal_flag"] = canary
        profile["projects"][0]["internal_review"] = canary
        profile["projects"][0]["visibility_note"] = canary
        profile["experience"][0]["internal_comment"] = canary
        profile["_meta"]["do_not_claim"] = [canary]
        profile["_meta"]["provenance"] = canary

        artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
        for name, content in artifacts.items():
            with self.subTest(artifact=name):
                self.assertNotIn(canary, content)

    # Field names and markers that indicate an internal working note.
    # Deliberately limited to STRUCTURAL names rather than any of the
    # note text itself: this test file is published too, so a list of
    # exact phrases-to-scrub would hint at whatever it was scrubbing.
    # The canary property tests above cover unknown-field exclusion
    # generally; these pin the specific shapes already seen.
    INTERNAL_MARKERS = [
        "REVIEW GATE",
        "do_not_claim",
        "visibility_note",
        "provenance",
    ]

    def test_real_content_model_leaks_nothing_internal(self):
        """End-to-end guard on the REAL content model, not a fixture.

        Reads content/profile.json as committed and asserts that none of
        its internal-only strings appear in any generated artifact. This
        is the test that would have caught the original leak.
        """
        profile = build.load_profile(REPO_ROOT / "content" / "profile.json")
        artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
        for name, content in artifacts.items():
            for marker in self.INTERNAL_MARKERS:
                with self.subTest(artifact=name, marker=marker):
                    self.assertNotIn(marker, content)

    def test_content_model_source_file_is_itself_publishable(self):
        """The SOURCE file must be clean too, not just what it renders.

        The allowlist protects the generated artifacts, but
        content/profile.json is committed to a PUBLIC repository, so its
        own bytes are published regardless of what the generator does
        with them. Keeping internal review notes in it would publish
        them via the repo even though every rendered page was clean -
        which is exactly the gap the first allowlist fix left open.
        """
        raw = (REPO_ROOT / "content" / "profile.json").read_text(encoding="utf-8")
        for marker in self.INTERNAL_MARKERS:
            with self.subTest(marker=marker):
                self.assertNotIn(marker, raw)


class UrlSchemeAllowlistTests(unittest.TestCase):
    """Every URL reaching an href must carry an allowlisted scheme.

    html.escape() neutralizes quotes and angle brackets, so it stops an
    attribute breakout - but it is NOT scheme validation. A value of
    "javascript:alert(1)" contains no character escape() touches, so it
    survives intact into href="..." and executes on click.

    Found by adversarial code review (2026-07-25). The generator already
    went to real effort to guard the JSON-LD </script> breakout, which
    made three unvalidated href sinks the gap in the same threat class.
    Fails CLOSED: a disallowed scheme aborts the build rather than
    rendering a neutered link, because a URL that cannot be published
    safely is an authoring mistake worth surfacing loudly.
    """

    def test_javascript_scheme_in_project_link_fails_build(self):
        """The reviewer's exact reproduction: a javascript: project link.

        Before the fix this shipped
        <a href="javascript:alert(document.cookie)"> verbatim.
        """
        profile = make_minimal_profile()
        profile["projects"][0]["links"] = [
            {"label": "Source", "url": "javascript:alert(document.cookie)"}
        ]
        with self.assertRaises(build.BuildError):
            build.generate_artifacts(profile, TEMPLATES_DIR)

    def test_javascript_scheme_in_social_profile_fails_build(self):
        """The header rel=me social nav is the second unvalidated sink."""
        profile = make_minimal_profile()
        profile["person"]["profiles"] = [
            {"label": "GitHub", "url": "javascript:alert(1)", "handle": "x"}
        ]
        with self.assertRaises(build.BuildError):
            build.generate_artifacts(profile, TEMPLATES_DIR)

    def test_data_uri_scheme_in_resume_url_fails_build(self):
        """data:text/html is the other classic script-bearing scheme."""
        profile = make_minimal_profile()
        profile["person"]["resume"]["url"] = "data:text/html;base64,PHNjcmlwdD4="
        with self.assertRaises(build.BuildError):
            build.generate_artifacts(profile, TEMPLATES_DIR)

    def test_obfuscated_scheme_is_rejected(self):
        """Case and embedded control characters must not defeat the check.

        Browsers strip tabs/newlines and lowercase the scheme before
        parsing, so "JaVaScRiPt:", " javascript:", and "java\\tscript:"
        are all live. A naive startswith("javascript:") misses all three.
        """
        for hostile in [
            "JaVaScRiPt:alert(1)",
            "  javascript:alert(1)",
            "java\tscript:alert(1)",
            "java\nscript:alert(1)",
            "\x00javascript:alert(1)",
        ]:
            with self.subTest(url=repr(hostile)):
                profile = make_minimal_profile()
                profile["projects"][0]["links"] = [{"label": "X", "url": hostile}]
                with self.assertRaises(build.BuildError):
                    build.generate_artifacts(profile, TEMPLATES_DIR)

    def test_protocol_relative_url_is_rejected(self):
        """"//evil.com" inherits the page scheme and leaves the origin.

        It is not a same-origin relative path despite the leading slash,
        so it must not ride the relative-URL exemption.
        """
        profile = make_minimal_profile()
        profile["projects"][0]["links"] = [{"label": "X", "url": "//evil.com/pwn"}]
        with self.assertRaises(build.BuildError):
            build.generate_artifacts(profile, TEMPLATES_DIR)

    def test_legitimate_urls_are_allowed(self):
        """https, http, mailto, and same-origin relative links all build.

        The guard has to be strict without being useless: these are the
        forms the real content model actually uses.
        """
        for benign in [
            "https://github.com/allstoncodes",
            "http://example.com/x",
            "mailto:someone@example.com",
            "/resume.pdf",
            "#projects",
            "./local.html",
        ]:
            with self.subTest(url=benign):
                profile = make_minimal_profile()
                profile["projects"][0]["links"] = [{"label": "X", "url": benign}]
                artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
                self.assertIn("index.html", artifacts)

    def test_email_with_query_injection_fails_build(self):
        """An email carrying &body= would inject mailto: parameters.

        The template renders href="mailto:${email_href}". Entity-escaping
        does not help, because the browser decodes entities before it
        parses the URI, so "a@b.c&body=..." becomes a real parameter.
        """
        profile = make_minimal_profile()
        profile["person"]["email"] = "test@example.com&body=send-me-your-password"
        with self.assertRaises(build.BuildError):
            build.generate_artifacts(profile, TEMPLATES_DIR)

    def test_javascript_scheme_in_employer_url_fails_build(self):
        """employer_url is not an href, but it is published in JSON-LD.

        An agent following worksFor.url deserves the same guarantee as a
        human clicking a link.
        """
        profile = make_minimal_profile()
        profile["person"]["current_role"]["employer_url"] = "javascript:alert(1)"
        with self.assertRaises(build.BuildError):
            build.generate_artifacts(profile, TEMPLATES_DIR)


class BareDollarPlaceholderTests(unittest.TestCase):
    """A bare "$name" typo must fail the build, not ship to a live page.

    string.Template resolves BOTH "${braced}" and bare "$identifier",
    but the unresolved-placeholder detector only matched the braced
    form. So a template typo that drops the braces produced a build
    that succeeded while a literal "$projects_html" replaced an entire
    page section. Invisible to --check (which compares generated
    against committed, not generated against intended) and invisible to
    every other test.

    Found by adversarial code review (2026-07-25). This is the highest
    severity finding in the set precisely because it is silent.
    """

    def test_bare_dollar_placeholder_is_detected(self):
        """The reviewer's exact typo: braces dropped and misspelled."""
        found = build.find_unresolved_placeholders("<main>$projecs_html</main>")
        self.assertIn("$projecs_html", found)

    def test_braced_placeholder_still_detected(self):
        """The original braced form must keep working (no regression)."""
        found = build.find_unresolved_placeholders("<main>${projects_html}</main>")
        self.assertIn("${projects_html}", found)

    def test_escaped_double_dollar_is_not_flagged(self):
        """"$$" is Template's literal-dollar escape and collapses to "$".

        By the time output is scanned, "$$foo" has already become "$foo"
        - so this test pins the behavior on what the scanner actually
        receives, and guards the real false-positive risk below.
        """
        self.assertEqual(build.find_unresolved_placeholders("cost: $$100"), [])

    def test_currency_in_real_content_is_not_flagged(self):
        """A dollar amount in prose must not trip the guard.

        This is not hypothetical: the real content model's American
        Express bullet reads "Replaced a $1M vendor relationship". A
        careless bare-dollar regex would fail every build.
        """
        self.assertEqual(build.find_unresolved_placeholders("Replaced a $1M vendor"), [])
        self.assertEqual(build.find_unresolved_placeholders("$100 and $5,000"), [])

    def test_bare_dollar_typo_in_a_template_aborts_the_build(self):
        """End-to-end: a template with a bare-dollar typo raises BuildError.

        Uses a throwaway template directory so the repo's real templates
        are untouched (a designer may be editing them concurrently).
        """
        with tempfile.TemporaryDirectory() as tmp:
            tmp_templates = Path(tmp)
            real_index = (TEMPLATES_DIR / "index.html").read_text(encoding="utf-8")
            # Drop the braces on the projects placeholder, exactly the
            # typo a human makes when hand-editing a template.
            broken = real_index.replace("${projects_html}", "$projecs_html")
            self.assertNotEqual(broken, real_index, "fixture must actually change")
            (tmp_templates / "index.html").write_text(broken, encoding="utf-8")
            (tmp_templates / "project-card.html").write_text(
                (TEMPLATES_DIR / "project-card.html").read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            with self.assertRaises(build.BuildError):
                build.generate_artifacts(make_minimal_profile(), tmp_templates)


class DuplicateSlugTests(unittest.TestCase):
    """Two projects sharing a slug would emit duplicate DOM ids.

    Duplicate ids are invalid HTML and break the aria-labelledby
    association that makes each project card announce correctly to a
    screen reader. Cheap to assert, so it is asserted.
    """

    def test_duplicate_project_slug_aborts_the_build(self):
        profile = make_minimal_profile()
        duplicate = dict(profile["projects"][0])
        profile["projects"] = [profile["projects"][0], duplicate]
        with self.assertRaises(build.BuildError):
            build.generate_artifacts(profile, TEMPLATES_DIR)

    def test_distinct_slugs_build_fine(self):
        profile = make_minimal_profile()
        second = dict(profile["projects"][0])
        second["slug"] = "second-project"
        profile["projects"] = [profile["projects"][0], second]
        artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
        self.assertIn("index.html", artifacts)


class AllowlistDepthCoverageTests(unittest.TestCase):
    """Close the coverage gap the reviewer flagged in the property test.

    The original canary test claimed "at every nesting depth" but never
    planted one inside person.profiles[i] or projects[i].links[j] - the
    two list-of-dict fields one level deeper. The reviewer verified
    those paths are in fact filtered; this pins that fact so the
    docstring's claim is actually enforced.
    """

    def test_canary_in_social_profile_entry_is_excluded(self):
        profile = make_minimal_profile()
        canary = "CANARY-NESTED-PROFILE"
        profile["person"]["profiles"][0]["internal_note"] = canary
        artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
        for name, content in artifacts.items():
            with self.subTest(artifact=name):
                self.assertNotIn(canary, content)

    def test_canary_in_project_link_entry_is_excluded(self):
        profile = make_minimal_profile()
        canary = "CANARY-NESTED-LINK"
        profile["projects"][0]["links"][0]["internal_note"] = canary
        artifacts = build.generate_artifacts(profile, TEMPLATES_DIR)
        for name, content in artifacts.items():
            with self.subTest(artifact=name):
                self.assertNotIn(canary, content)


if __name__ == "__main__":
    unittest.main()
