"""build/build.py - zero-dependency static-site generator for allstonf.github.io.

Reads content/profile.json (the canonical, human-authored content model)
plus the templates in templates/, and writes five artifacts: the human
surface (index.html), the agent surfaces (llms.txt, api/profile.json),
and the two crawl-control files (robots.txt, sitemap.xml). Nothing in
this module reads from or writes to any other data source - if a fact
needs to change, it changes in content/profile.json and this script
re-derives every output from it.

Stdlib only: json, pathlib, html, string, xml, datetime, re, argparse.
No pip installs, no third-party imports, ever - the whole point is that
this build has zero supply-chain surface.

Template contract
------------------
templates/index.html and templates/project-card.html are plain text
files containing ${name}-style placeholders, rendered with
string.Template.safe_substitute(). safe_substitute() is used
deliberately instead of substitute(): a missing mapping key must not
raise mid-render (a partially-built page is worse than a slightly wrong
one at test time), but a leftover, un-substituted "${...}" token in the
FINAL output is exactly the failure mode this generator exists to
prevent - a typo'd placeholder shipping to a live page, undetected.
find_unresolved_placeholders() is the explicit check that closes that
gap: generate_artifacts() runs it over every rendered artifact and
raises BuildError the moment one is found, so main() can exit non-zero
instead of writing bad files.

List-shaped content (projects, experience entries, social links, about
paragraphs, project bullets/stack/links) is never passed into
string.Template as a nested structure - string.Template only
understands flat scalar substitution. Instead, each item in a list is
rendered by formatting a small partial (an <li> line, a project card)
once per item, and the joined block is substituted as a SINGLE scalar
placeholder (e.g. ${projects_html} is one big pre-joined string of N
project cards, not N separate substitutions).

Because string.Template treats "$" as the start of a placeholder, any
literal dollar sign that needs to appear in template source text (CSS embedded
inline, prose about money, etc.) must be escaped as "$$" in the
template file. Neither shipped template currently contains a literal
"$", but this is the reason a future edit needs to know about.
"""

import argparse
import html
import json
import re
import string
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

# Matches a leftover placeholder in EITHER form string.Template resolves:
# braced "${name}" and bare "$name". Both must be caught. Matching only
# the braced form was a real defect: a template typo that drops the
# braces ("$projecs_html") builds successfully and ships that literal
# string in place of a whole page section, which --check cannot see
# because it compares generated against committed, not against intended.
#
# The braced alternative is listed first so "${name}" is reported in its
# full form rather than as a bare "$" fragment. A bare match requires a
# leading letter or underscore, exactly as Template does, which is why a
# currency amount like "$1M vendor relationship" (real copy in the
# content model) does not false-positive. "$$" is Template's literal
# escape and has already collapsed to a single "$" by the time output is
# scanned, so it cannot match either.
_PLACEHOLDER_PATTERN = re.compile(
    r"\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*"
)

# URL schemes allowed to reach an href or a published JSON-LD url.
# html.escape() is not scheme validation: "javascript:alert(1)" contains
# no character it touches, so it survives escaping intact and executes
# on click. Hence an explicit allowlist, applied at every URL sink.
_ALLOWED_URL_SCHEMES = ("https:", "http:", "mailto:")

# Same-origin relative forms, which carry no scheme and are always safe.
# "//" is deliberately NOT here: a protocol-relative URL looks relative
# but leaves the origin entirely.
_RELATIVE_URL_PREFIXES = ("/", "#", "./", "../")

# C0 control characters and space. Browsers strip these before parsing a
# URL scheme, so "java\tscript:" and " javascript:" are both live links
# and the check has to normalize them away before comparing.
_URL_IGNORED_CHARS = re.compile(r"[\x00-\x20]")

# A conservative email shape. The point is not RFC completeness; it is
# that the value lands in href="mailto:${...}", where an unescaped "&"
# or "?" becomes a real mailto parameter (&body=, &cc=). Entity-escaping
# does not help, because the browser decodes entities before parsing the
# URI.
_EMAIL_PATTERN = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")

# The sitemap.xml namespace, per https://www.sitemaps.org/protocol.html.
_SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9"


class BuildError(Exception):
    """Raised when a generated artifact would be defective if shipped.

    Covers an unresolved template placeholder and a stray em dash
    (U+2014, a hard style rule from the repo owner). Both are caught in
    generate_artifacts() before any file is written, and main() turns
    this exception into a non-zero exit code rather than a partially
    correct page on disk.
    """


def find_unresolved_placeholders(text):
    """Return every "${name}" token still present in `text`, deduped.

    safe_substitute() silently leaves a placeholder in place when its
    key is missing from the mapping, instead of raising. This function
    is the check that turns that silence into a loud, catchable signal.
    Order is first-seen (not sorted) so a caller can report findings in
    the order they'd actually be encountered reading the page top to
    bottom; tests only assert membership, so a stable order isn't
    otherwise required.
    """
    seen = []
    for match in _PLACEHOLDER_PATTERN.findall(text):
        if match not in seen:
            seen.append(match)
    return seen


def esc(value):
    """HTML-escape `value` for both element-text and attribute context.

    html.escape(s, quote=True) neutralizes & < > " ' - the quote
    character escaping is what makes this ALSO safe to interpolate
    inside a double-quoted HTML attribute (e.g. href="${esc(url)}"),
    not just inside element text. One function covers both contexts
    because both need the same character set neutralized; a value
    containing a literal double quote could otherwise terminate an
    attribute early and let an attacker inject a new attribute or tag.
    """
    return html.escape(str(value), quote=True)


def validate_url(value, field="url"):
    """Return `value` normalized, or raise BuildError if unpublishable.

    Scheme validation, with no HTML escaping - so this is the right entry
    point for a URL headed into JSON-LD, where HTML entities would be
    wrong. For a URL headed into an href, use esc_url() instead.

    Accepts an allowlisted scheme (https, http, mailto) or a same-origin
    relative form. Rejects everything else, including a protocol-relative
    "//host" that looks relative but leaves the origin, and a bare
    "example.com" carrying no scheme at all.

    Fails CLOSED by aborting the build rather than defanging the link: a
    URL that cannot be published safely is an authoring mistake, and a
    loud failure at build time beats a silently rewritten link on a
    public page.

    Returns the NORMALIZED string (C0 control characters and spaces
    removed) so that the value which was checked is byte-for-byte the
    value that ships. Otherwise a tab hidden inside an approved URL
    could still change where a browser navigates, since browsers strip
    those characters before parsing.
    """
    cleaned = _URL_IGNORED_CHARS.sub("", str(value))
    probe = cleaned.lower()
    if probe.startswith("//"):
        raise BuildError(
            f"{field}: protocol-relative URL {cleaned!r} leaves the origin; "
            "give it an explicit https:// scheme"
        )
    if probe.startswith(_RELATIVE_URL_PREFIXES) or probe.startswith(_ALLOWED_URL_SCHEMES):
        return cleaned
    raise BuildError(
        f"{field}: disallowed or missing URL scheme in {cleaned!r}; "
        f"allowed schemes are {', '.join(_ALLOWED_URL_SCHEMES)} "
        "or a same-origin relative path"
    )


def esc_url(value, field="url"):
    """Validate `value`'s scheme, then HTML-escape it for an href.

    esc() alone is not enough for a URL: it neutralizes quotes and angle
    brackets, which stops an attribute breakout, but it performs no
    scheme validation, so "javascript:alert(1)" survives escaping
    intact and executes on click. Every href sink goes through here.
    """
    return esc(validate_url(value, field))


def load_profile(path):
    """Parse content/profile.json into a dict. No validation beyond
    what json.loads itself performs - the content model is hand-authored
    and reviewed by its owner, not machine-generated input."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def format_date_range(start, end):
    """Render an experience date range as 'YYYY-MM - YYYY-MM' or, for a
    still-current role (end is None/falsy), 'YYYY-MM - Present'.

    Uses a plain hyphen-minus surrounded by spaces, never an em dash
    (U+2014) - the repo owner's standing style rule applies to every
    generated artifact, and a date range is an easy place to reach for
    "-" out of habit.
    """
    end_label = end if end else "Present"
    return f"{start} - {end_label}"


def render_social_links(profiles):
    """Render the header's rel="me" social nav as one <a> per line.

    Every entry is an external link, so it carries both rel="me" (the
    IndieAuth identity-verification convention the spec calls for) and
    rel="noopener" (safe target="_blank" per the spec's "external links
    get rel=noopener" requirement) on the same anchor.
    """
    lines = [
        f'      <a href="{esc_url(profile["url"], "person.profiles[].url")}"'
        f' rel="me noopener" target="_blank">'
        f'{esc(profile["label"])}</a>'
        for profile in profiles
    ]
    return "\n".join(lines)


def render_about_html(paragraphs):
    """Render the About section body as one <p> per source paragraph."""
    return "\n".join(f"      <p>{esc(paragraph)}</p>" for paragraph in paragraphs)


def render_bullets_html(bullets):
    """Render a list of bullet strings as <li> lines for a <ul>."""
    return "\n".join(f"        <li>{esc(bullet)}</li>" for bullet in bullets)


def render_stack_html(stack):
    """Render a project's technology stack as <li> lines for a <ul>."""
    return "\n".join(f'        <li class="stack-item">{esc(item)}</li>' for item in stack)


def render_links_html(links):
    """Render a project's external links (e.g. Source, Live) as anchors.

    Returns an empty string for a project that has no links, of which
    there are several - safe_substitute then renders an empty block
    rather than leaving a dangling placeholder.
    """
    return "\n".join(
        f'    <a href="{esc_url(link["url"], "projects[].links[].url")}"'
        f' rel="noopener" target="_blank">{esc(link["label"])}</a>'
        for link in links
    )


def render_projects_html(projects, project_card_template):
    """Render every project as one project-card partial, joined.

    Each project is rendered independently via safe_substitute against
    the shared templates/project-card.html template, then the resulting
    HTML blocks are joined into a single string - this is the "render a
    partial per list item, substitute the join as one scalar" pattern
    documented in this module's docstring.
    """
    cards = []
    for project in projects:
        outcome = project.get("outcome")
        # A project without a stated outcome (most of them - the
        # content model is honest that most of these have no measured
        # result yet) renders no outcome paragraph at all, rather than
        # an empty or "N/A" one.
        outcome_html = (
            f'<p class="project-card__outcome">{esc(outcome)}</p>' if outcome else ""
        )
        mapping = {
            "project_slug": esc(project["slug"]),
            "project_name": esc(project["name"]),
            "project_summary": esc(project["summary"]),
            "project_outcome_html": outcome_html,
            "project_bullets_html": render_bullets_html(project["bullets"]),
            "project_stack_html": render_stack_html(project["stack"]),
            "project_links_html": render_links_html(project.get("links", [])),
        }
        cards.append(project_card_template.safe_substitute(mapping))
    return "\n".join(cards)


def render_experience_html(experience):
    """Render the experience list as one <article> per role, newest first
    (the content model is already ordered newest-first; this function
    does not re-sort it)."""
    entries = []
    for job in experience:
        date_range = format_date_range(job["start"], job.get("end"))
        # A still-current role (end is None) gets a distinguishing CSS
        # hook; the header's current_role_line_html is what actually
        # makes "Apple, currently" visible without reading this far down
        # the page, per the spec's explicit requirement.
        current_class = " experience-entry--current" if not job.get("end") else ""
        entries.append(
            f'      <article class="experience-entry{current_class}">\n'
            f"        <h3>{esc(job['employer'])}</h3>\n"
            f'        <p class="experience-entry__title">{esc(job["title"])}</p>\n'
            f'        <p class="experience-entry__meta">{esc(date_range)} &middot; '
            f'{esc(job["location"])}</p>\n'
            f"        <ul>\n{render_bullets_html(job['bullets'])}\n        </ul>\n"
            f"      </article>"
        )
    return "\n".join(entries)


def build_json_ld(profile):
    """Build the schema.org Person dict backing the ld+json block.

    Returned as a plain dict (not a string) so callers can also unit
    test its shape directly, separately from the JSON-encoding and
    </script>-escaping done in render_json_ld_script().
    """
    person = profile["person"]
    current_role = person["current_role"]
    education = person.get("education")

    data = {
        "@context": "https://schema.org",
        "@type": "Person",
        "name": person["name"],
        "jobTitle": current_role["title"],
        "worksFor": {"@type": "Organization", "name": current_role["employer"]},
        "knowsAbout": person.get("knows_about", []),
        "email": person["email"],
        "url": profile["site"]["url"],
        "sameAs": [p["url"] for p in person.get("profiles", [])],
    }
    if current_role.get("employer_url"):
        # Not an href, but an agent following worksFor.url deserves the
        # same scheme guarantee a human clicking a link gets.
        data["worksFor"]["url"] = validate_url(
            current_role["employer_url"], "person.current_role.employer_url"
        )
    if education:
        alumni_of = {"@type": "CollegeOrUniversity", "name": education["institution"]}
        if education.get("institution_url"):
            alumni_of["url"] = education["institution_url"]
        data["alumniOf"] = alumni_of
    return data


def render_json_ld_script(profile):
    """Serialize the Person dict to JSON text, safe to embed inline in a
    <script type="application/ld+json"> block.

    Generated via json.dumps (never hand-built string concatenation),
    per the spec's explicit requirement. Guards against a </script>
    breakout: any literal "</" sequence in the dumped text (which can
    only occur inside a string value, since JSON's structural
    characters never include "<") is rewritten to "<\\/". "\\/" is a
    valid JSON escape for a bare "/", so json.loads() on the embedded
    text still recovers the original, unescaped string exactly - this
    is what the round-trip test verifies.
    """
    text = json.dumps(build_json_ld(profile), indent=2, ensure_ascii=False)
    return text.replace("</", "<\\/")


def render_index_html(profile, index_template, project_card_template):
    """Render the full human-facing index.html from the profile + the
    two loaded string.Template instances."""
    site = profile["site"]
    person = profile["person"]
    current_role = person["current_role"]

    # The spec's explicit requirement: a visible line naming Apple as
    # the CURRENT employer, since the entire point of this rebuild is
    # that the live page still claims Cisco.
    current_role_line_html = (
        f'<p class="site-header__current-role">Currently: '
        f'{esc(current_role["title"])} at <strong>{esc(current_role["employer"])}</strong></p>'
    )

    mapping = {
        "lang": esc(site["locale"]),
        "title": esc(site["title"]),
        "meta_description": esc(site["description"]),
        "author": esc(person["name"]),
        "theme_color": esc(site["theme_color"]),
        "canonical_url": esc_url(site["url"], "site.url"),
        "og_type": "profile",
        "og_title": esc(site["title"]),
        "og_description": esc(site["description"]),
        "og_url": esc_url(site["url"], "site.url"),
        "twitter_card": "summary",
        "twitter_title": esc(site["title"]),
        "twitter_description": esc(site["description"]),
        "json_ld_script": render_json_ld_script(profile),
        "person_name": esc(person["name"]),
        "person_headline": esc(person["headline"]),
        "person_tagline": esc(person["tagline"]),
        "current_role_line_html": current_role_line_html,
        "email_href": esc(person["email"]),
        "email_display": esc(person["email"]),
        "social_links_html": render_social_links(person.get("profiles", [])),
        "resume_url": esc_url(person["resume"]["url"], "person.resume.url"),
        # Deliberately NOT rendering person.resume.note anywhere: that
        # field is an internal review-gate instruction for Allston, not
        # public site copy, and content/profile.json must not be edited
        # to remove it just to keep it off the live page.
        "resume_label": esc(person["resume"]["label"]),
        "about_html": render_about_html(profile.get("about", [])),
        "projects_html": render_projects_html(
            profile.get("projects", []), project_card_template
        ),
        "experience_html": render_experience_html(profile.get("experience", [])),
        "footer_name": esc(person["name"]),
        "footer_email": esc(person["email"]),
    }
    return index_template.safe_substitute(mapping)


def render_llms_txt(profile):
    """Render llms.txt per the llmstxt.org convention: an H1 name, a
    blockquote summary, then markdown sections for projects and
    experience, built from agent_surface.llms_txt_intro/_guidance."""
    person = profile["person"]
    site = profile["site"]
    agent = profile["agent_surface"]

    lines = [
        f"# {person['name']}",
        "",
        f"> {site['description']}",
        "",
        agent["llms_txt_intro"],
        "",
        agent["llms_txt_guidance"],
        "",
        "## Projects",
        "",
    ]
    for project in profile.get("projects", []):
        links = project.get("links") or []
        if links:
            lines.append(f"- [{project['name']}]({links[0]['url']}): {project['summary']}")
        else:
            lines.append(f"- {project['name']}: {project['summary']}")
    lines += ["", "## Experience", ""]
    for job in profile.get("experience", []):
        date_range = format_date_range(job["start"], job.get("end"))
        lines.append(f"- {job['employer']} - {job['title']} ({date_range})")
    return "\n".join(lines) + "\n"


# Explicit allowlists for the public API projection.
#
# The content model is edited by hand, so a field may be added to it
# for local or editorial reasons without any intent to publish that
# field. Copying whole subtrees into a public artifact would fail OPEN:
# whatever gets added next publishes itself.
#
# So the projection opts fields IN rather than filtering unwanted ones
# out. A key absent from these tuples cannot reach a public surface, by
# construction. This fails CLOSED on purpose: the worst case for an
# over-strict allowlist is a field missing from a page, which is obvious
# and recoverable. The worst case for a permissive one is publishing
# something that was never meant to ship, on a surface whose git
# history is permanent.
PUBLIC_PERSON_FIELDS = (
    "name",
    "headline",
    "tagline",
    "location",
    "email",
    "current_role",
    "education",
    "knows_about",
    "profiles",
    "resume",
)
PUBLIC_CURRENT_ROLE_FIELDS = ("title", "employer", "employer_url", "start", "location")
PUBLIC_EDUCATION_FIELDS = ("institution", "institution_url", "credential", "detail")
PUBLIC_SOCIAL_PROFILE_FIELDS = ("label", "url", "handle")
PUBLIC_RESUME_FIELDS = ("url", "label")
PUBLIC_PROJECT_FIELDS = (
    "slug",
    "name",
    "featured",
    "summary",
    "outcome",
    "bullets",
    "stack",
    "links",
)
PUBLIC_LINK_FIELDS = ("label", "url")
PUBLIC_EXPERIENCE_FIELDS = ("employer", "title", "start", "end", "location", "bullets")


def pick(source, fields):
    """Return a dict containing only `fields`, in allowlist order.

    The single primitive behind the fail-closed projection. Because the
    result is BUILT FROM the allowlist rather than copied from `source`
    and then pruned, an unrecognized key in `source` cannot survive -
    there is no code path that would carry it through. Missing keys are
    skipped rather than raising, so an optional field stays optional.
    """
    return {key: source[key] for key in fields if key in source}


def render_api_profile(profile):
    """Render api/profile.json: a pretty-printed machine projection of
    the content model.

    Publishes only allowlisted fields at every nesting depth (see the
    PUBLIC_*_FIELDS tuples above). The top-level `_meta`, `site`, and
    `agent_surface` sections are omitted entirely, and internal notes
    nested inside person/projects are dropped by the allowlist.
    """
    person = pick(profile["person"], PUBLIC_PERSON_FIELDS)
    if "current_role" in person:
        person["current_role"] = pick(person["current_role"], PUBLIC_CURRENT_ROLE_FIELDS)
    if "education" in person:
        person["education"] = pick(person["education"], PUBLIC_EDUCATION_FIELDS)
    if "resume" in person:
        person["resume"] = pick(person["resume"], PUBLIC_RESUME_FIELDS)
    if "profiles" in person:
        person["profiles"] = [
            pick(entry, PUBLIC_SOCIAL_PROFILE_FIELDS) for entry in person["profiles"]
        ]

    projects = []
    for project in profile.get("projects", []):
        public_project = pick(project, PUBLIC_PROJECT_FIELDS)
        public_project["links"] = [
            pick(link, PUBLIC_LINK_FIELDS) for link in project.get("links", [])
        ]
        projects.append(public_project)

    projection = {
        "person": person,
        "about": profile["about"],
        "projects": projects,
        "experience": [
            pick(job, PUBLIC_EXPERIENCE_FIELDS) for job in profile.get("experience", [])
        ],
    }
    return json.dumps(projection, indent=2, ensure_ascii=False) + "\n"


def render_robots_txt(profile):
    """Render robots.txt: explicitly welcomes every crawler, and calls
    out the named AI/agent crawlers by name with an explicit Allow: /,
    per the spec (this repo's entire point is being agent-legible)."""
    site_url = profile["site"]["url"].rstrip("/")
    named_bots = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]
    lines = ["User-agent: *", "Allow: /", ""]
    for bot in named_bots:
        lines += [f"User-agent: {bot}", "Allow: /", ""]
    lines += [
        f"Sitemap: {site_url}/sitemap.xml",
        f"# Agent-readable profile: {site_url}/llms.txt",
    ]
    return "\n".join(lines) + "\n"


def render_sitemap_xml(profile):
    """Render sitemap.xml as a valid urlset for /, /llms.txt, and
    /api/profile.json.

    lastmod comes from _meta.last_updated in the content model, NOT
    from datetime.now() - using the wall clock would make the sitemap
    (and therefore the whole build) non-reproducible, since a rebuild a
    day later would produce different bytes from unchanged input.
    Built with xml.etree.ElementTree rather than hand-built string
    concatenation, so the output is guaranteed well-formed XML.
    """
    site_url = profile["site"]["url"].rstrip("/")
    last_updated = profile["_meta"]["last_updated"]
    paths = ["/", "/llms.txt", "/api/profile.json"]

    ET.register_namespace("", _SITEMAP_NS)
    root = ET.Element(f"{{{_SITEMAP_NS}}}urlset")
    for path in paths:
        url_el = ET.SubElement(root, f"{{{_SITEMAP_NS}}}url")
        loc_el = ET.SubElement(url_el, f"{{{_SITEMAP_NS}}}loc")
        loc_el.text = f"{site_url}{path}"
        lastmod_el = ET.SubElement(url_el, f"{{{_SITEMAP_NS}}}lastmod")
        lastmod_el.text = last_updated

    body = ET.tostring(root, encoding="unicode")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + body + "\n"


def validate_profile(profile):
    """Raise BuildError on content-model problems that templates cannot catch.

    These are whole-document invariants, so they cannot be enforced by
    the per-value escaping helpers. Checked before any rendering starts,
    so the build fails before it writes a partially correct page.

    1. Project slugs must be unique. Each slug becomes a DOM id
       (`id="project-<slug>"` plus its `-heading` partner), so a
       duplicate emits invalid HTML and breaks the aria-labelledby
       association that makes a card announce correctly to a screen
       reader.
    2. The email must match a conservative shape. It lands in
       `href="mailto:${...}"`, where an "&" or "?" becomes a real mailto
       parameter (&body=, &cc=). HTML-entity escaping cannot prevent
       that, because the browser decodes entities before it parses the
       URI.
    """
    slugs = [project.get("slug") for project in profile.get("projects", [])]
    duplicates = sorted({slug for slug in slugs if slugs.count(slug) > 1})
    if duplicates:
        raise BuildError(
            f"duplicate project slug(s) {duplicates}: each slug becomes a DOM id, "
            "so duplicates emit invalid HTML and break aria-labelledby"
        )

    email = str(profile["person"]["email"])
    if not _EMAIL_PATTERN.match(email):
        raise BuildError(
            f"person.email {email!r} is not a plain address; it is rendered into "
            'href="mailto:..." where characters like & or ? become mailto parameters'
        )


def generate_artifacts(profile, templates_dir):
    """Render every output artifact from `profile` and the templates in
    `templates_dir`, returning {relative_path: content}.

    Raises BuildError before returning anything if either safety check
    fails: an unresolved "${...}" template placeholder in any artifact,
    or a stray em dash (U+2014) anywhere in the generated text. Both
    checks run across ALL artifacts, not just index.html, because
    llms.txt and api/profile.json are just as public and just as easy
    to accidentally break.
    """
    validate_profile(profile)

    templates_dir = Path(templates_dir)
    index_template = string.Template(
        (templates_dir / "index.html").read_text(encoding="utf-8")
    )
    project_card_template = string.Template(
        (templates_dir / "project-card.html").read_text(encoding="utf-8")
    )

    artifacts = {
        "index.html": render_index_html(profile, index_template, project_card_template),
        "llms.txt": render_llms_txt(profile),
        "api/profile.json": render_api_profile(profile),
        "robots.txt": render_robots_txt(profile),
        "sitemap.xml": render_sitemap_xml(profile),
    }

    for name, content in artifacts.items():
        unresolved = find_unresolved_placeholders(content)
        if unresolved:
            raise BuildError(f"unresolved template placeholder(s) in {name}: {unresolved}")
        if "\u2014" in content:
            raise BuildError(f"em dash (U+2014) found in generated {name}")

    return artifacts


def write_artifacts(artifacts, output_root):
    """Write every artifact to its relative path under `output_root`,
    creating parent directories (e.g. api/) as needed. Returns the list
    of absolute paths written."""
    output_root = Path(output_root)
    written = []
    for rel_path, content in artifacts.items():
        dest = output_root / rel_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content, encoding="utf-8")
        written.append(dest)
    return written


def check_artifacts(artifacts, repo_root):
    """Compare freshly generated `artifacts` against what is currently
    committed on disk at `repo_root`. Returns the list of relative paths
    that are missing or differ - an empty list means everything is
    up to date. Used by --check as a pre-commit drift guard."""
    repo_root = Path(repo_root)
    diffs = []
    for rel_path, content in artifacts.items():
        dest = repo_root / rel_path
        if not dest.exists() or dest.read_text(encoding="utf-8") != content:
            diffs.append(rel_path)
    return diffs


def main(argv=None):
    """CLI entry point. Builds every artifact from content/profile.json
    into the repo root; with --check, builds in memory and diffs
    against the committed files instead of writing, exiting non-zero on
    any drift (a pre-commit guard against a stale generated artifact)."""
    parser = argparse.ArgumentParser(
        description="Build allstonf.github.io from content/profile.json."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Diff generated output against committed artifacts instead of writing; "
        "exit non-zero if anything is stale.",
    )
    args = parser.parse_args(argv)

    # build.py lives at <repo_root>/build/build.py, so its own file
    # location (two parents up) is the repo root - this must hold
    # regardless of the caller's current working directory.
    repo_root = Path(__file__).resolve().parent.parent
    templates_dir = repo_root / "templates"
    content_path = repo_root / "content" / "profile.json"

    profile = load_profile(content_path)

    try:
        artifacts = generate_artifacts(profile, templates_dir)
    except BuildError as exc:
        print(f"build error: {exc}", file=sys.stderr)
        return 1

    if args.check:
        diffs = check_artifacts(artifacts, repo_root)
        if diffs:
            print("build --check: stale or missing artifact(s):", file=sys.stderr)
            for rel_path in diffs:
                print(f"  {rel_path}", file=sys.stderr)
            return 1
        print("build --check: all artifacts up to date")
        return 0

    written = write_artifacts(artifacts, repo_root)
    print(f"wrote {len(written)} artifact(s):")
    for path in written:
        print(f"  {path.relative_to(repo_root)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
