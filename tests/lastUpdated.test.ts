// tests/lastUpdated.test.ts - the freshness-signal resolver.
//
// sitemap.xml's lastmod and JSON-LD's dateModified both sourced from
// _meta.last_updated (a hand-edited content-model field) until this task,
// which measured that field 7 days stale against the live republish date -
// exactly the signal a crawler uses to decide whether to re-crawl. See the
// evidence table in docs/superpowers/plans/2026-08-01-personal-site-
// discoverability-fixes.md.
//
// resolveLastUpdated() derives the date from the git commit date of HEAD
// instead, which keeps the reproducible-build property intact (the same
// commit always yields the same date) while advancing whenever content
// actually changes. The git read is injected as a parameter rather than
// called directly, so this suite can exercise the throw/malformed/injected
// paths without shelling out to git or mutating the real repository.
import { describe, expect, it } from 'vitest'
import profile from '../content/profile.json'
import { resolveLastUpdated } from '../src/lib/lastUpdated'

describe('resolveLastUpdated', () => {
  it('returns a YYYY-MM-DD string', () => {
    const result = resolveLastUpdated(profile, () => '2026-08-01')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns the injected git-reader value verbatim when it is well-formed', () => {
    expect(resolveLastUpdated(profile, () => '2026-08-01')).toBe('2026-08-01')
  })

  it('falls back to profile._meta.last_updated when the reader throws', () => {
    // A shallow CI clone, or a tarball build with no .git directory at all,
    // has no commit history to read - `git log` exits non-zero and the
    // default reader's execSync call throws. Falling back to the
    // hand-edited constant here is what keeps the build from failing
    // outright in that environment, at the cost of the freshness signal
    // going stale again - the same tradeoff the CI verification step in
    // the plan exists to catch if it silently happens on the live site.
    const throwingReader = () => {
      throw new Error('git log failed: not a git repository')
    }
    expect(resolveLastUpdated(profile, throwingReader)).toBe(profile._meta.last_updated)
  })

  it('falls back to profile._meta.last_updated when the reader returns a non-date string', () => {
    // A reader that returns SOMETHING but not a parseable date (a stray
    // "fatal: ..." line captured as stdout instead of exit-code failure,
    // for instance) must not publish garbage into a public sitemap.
    expect(resolveLastUpdated(profile, () => 'not-a-date')).toBe(profile._meta.last_updated)
  })

  it('falls back to profile._meta.last_updated when the reader returns an empty string', () => {
    expect(resolveLastUpdated(profile, () => '')).toBe(profile._meta.last_updated)
  })

  it('is pure given its injected reader: calling it twice returns the same answer', () => {
    const reader = () => '2026-08-01'
    expect(resolveLastUpdated(profile, reader)).toBe(resolveLastUpdated(profile, reader))
  })
})
