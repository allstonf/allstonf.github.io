// src/lib/lastUpdated.ts - the freshness-signal resolver shared by
// sitemap.xml's lastmod and the JSON-LD WebSite node's dateModified.
//
// Both signals used to read straight from _meta.last_updated, a
// hand-edited content-model field. That field was measured 7 days
// stale against the live republish date - exactly the signal a
// crawler uses to decide whether to re-crawl, and a live cause of the
// search index still describing Allston as working at Cisco. See the
// evidence table in docs/superpowers/plans/2026-08-01-personal-site-
// discoverability-fixes.md.
//
// The wall clock is not the fix: using it would make a rebuild of
// unchanged content produce different bytes, breaking the
// reproducible-build property renderSitemapXml() and buildJsonLd()
// already lock in (see their own module comments). The git commit
// date of HEAD satisfies both properties at once - the same commit
// always yields the same date (reproducible), and it advances
// whenever content actually changes (accurate).
//
// The git read is injected as `readGitDate` rather than called
// directly, for two reasons: it keeps this function pure and
// unit-testable without shelling out to git in every test run, and it
// gives every caller a single fallback path to fall back to
// profile._meta.last_updated when `git log` is unavailable at all
// (a shallow CI clone or a tarball build with no .git directory) or
// returns something that is not actually a date - never publish
// garbage into a public sitemap or JSON-LD block.
import { execSync } from 'node:child_process'

// Matches only a well-formed YYYY-MM-DD date. `git log -1 --format=%cs`
// already emits exactly this shape on success, so this is a guard
// against a malformed or unexpected reader result (a captured stderr
// line, an empty string), not a general-purpose date parser.
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * The real git reader used in production: `git log -1 --format=%cs`,
 * the commit date of HEAD in YYYY-MM-DD form (the `%cs` format is
 * git's own "committer date, short format" - no manual date
 * formatting needed).
 *
 * `stdio: ['ignore', 'pipe', 'ignore']` suppresses stdin and stderr so
 * a missing .git directory produces a clean thrown Error from
 * execSync rather than noise on the build's own stderr; a short
 * timeout keeps a hung git process from stalling the build
 * indefinitely.
 */
function defaultReader(): string {
  return execSync('git log -1 --format=%cs', {
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
  })
    .toString()
    .trim()
}

/**
 * Resolve the freshness-signal date to publish: the git commit date
 * of HEAD, or `profile._meta.last_updated` if the reader throws (no
 * git available) or returns a value that is not a well-formed
 * YYYY-MM-DD date.
 *
 * `readGitDate` defaults to `defaultReader` (the real `git log` call)
 * so production callers need pass nothing; tests inject a stub to
 * exercise the success, throw, and malformed-value paths without
 * touching the real repository.
 */
export function resolveLastUpdated(profile: any, readGitDate: () => string = defaultReader): string {
  let candidate: string
  try {
    candidate = readGitDate()
  } catch {
    return profile._meta.last_updated
  }

  if (!ISO_DATE_PATTERN.test(candidate)) {
    return profile._meta.last_updated
  }

  return candidate
}
