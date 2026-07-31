// tests/publicProjection.test.ts - the security-critical projection.
//
// Two things are under test here, both ported from v1's build/build.py
// after a real leak: (1) publicProjection() must build the public API
// shape FROM an allowlist rather than copy-then-prune, so an unknown
// field added to content/profile.json for local/editorial reasons can
// never reach a public surface; (2) validateUrl() must fail closed on
// any URL scheme that is not https/http/mailto or a same-origin
// relative form, since HTML/JSON escaping alone does not stop a
// javascript: or data: URL from executing on click.
import { describe, it, expect } from 'vitest'
import { publicProjection } from '../src/lib/publicProjection'
import { validateUrl, UnpublishableUrlError } from '../src/lib/url'
import profile from '../content/profile.json'

const CANARY = 'CANARY-INTERNAL-DO-NOT-PUBLISH'

describe('publicProjection fails closed', () => {
  it('excludes unknown fields at every nesting depth', () => {
    // Real synthetic canaries, never restated withheld editorial
    // content, per the public-repo rule - this is the only marker any
    // future reader of this file will find.
    const dirty = structuredClone(profile) as any
    dirty.person.internal_todo = CANARY
    dirty.person.resume.internal_flag = CANARY
    dirty.person.current_role.internal_comment = CANARY
    dirty.person.profiles[0].internal_note = CANARY
    dirty.projects[0].internal_review = CANARY
    dirty.projects[0].links[0].internal_note = CANARY
    dirty.experience[0].internal_comment = CANARY
    expect(JSON.stringify(publicProjection(dirty))).not.toContain(CANARY)
  })

  it('keeps the fields the page actually needs', () => {
    const out = publicProjection(profile) as any
    expect(out.person.name).toBeTruthy()
    expect(out.person.current_role.employer).toBe('Apple')
    expect(out.projects.length).toBe(profile.projects.length)
  })
})

describe('validateUrl fails closed on the URL-based-XSS scheme class', () => {
  // Found by v1's adversarial code review: html.escape() (and Astro's
  // equivalent automatic attribute escaping) neutralizes quotes and
  // angle brackets, which stops an attribute breakout, but performs no
  // scheme validation, so "javascript:alert(1)" survives escaping
  // intact and executes on click.

  it('rejects a javascript: scheme', () => {
    expect(() => validateUrl('javascript:alert(document.cookie)', 'test')).toThrow(
      UnpublishableUrlError,
    )
  })

  it('rejects a data:text/html scheme', () => {
    expect(() => validateUrl('data:text/html;base64,PHNjcmlwdD4=', 'test')).toThrow(
      UnpublishableUrlError,
    )
  })

  it('rejects obfuscated variants (case, tabs, newlines, leading control chars)', () => {
    // Browsers strip C0 control characters and lowercase the scheme
    // before parsing, so "JaVaScRiPt:", " javascript:", and
    // "java\tscript:" are all live. A naive startsWith('javascript:')
    // misses all of these.
    const hostile = [
      'JaVaScRiPt:alert(1)',
      '  javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      '\x00javascript:alert(1)',
    ]
    for (const url of hostile) {
      expect(() => validateUrl(url, 'test')).toThrow(UnpublishableUrlError)
    }
  })

  it('rejects a protocol-relative //host URL', () => {
    // "//evil.com" inherits the page's scheme and leaves the origin.
    // It must not ride the relative-URL exemption despite the leading
    // slash it shares with a genuine same-origin path.
    expect(() => validateUrl('//evil.com/pwn', 'test')).toThrow(UnpublishableUrlError)
  })

  it('accepts the legitimate scheme set', () => {
    const benign = [
      'https://github.com/allstoncodes',
      'http://example.com/x',
      'mailto:someone@example.com',
      '/resume.pdf',
      '#projects',
      './local.html',
    ]
    for (const url of benign) {
      expect(() => validateUrl(url, 'test')).not.toThrow()
    }
  })
})

describe('project period reaches the public projection', () => {
  // `period` dates each project so a reader can tell 2019-2020
  // coursework from current work. Because publicProjection() builds
  // FROM an allowlist, a field absent from PUBLIC_PROJECT_FIELDS is
  // dropped silently - it would render on the page and in the markdown
  // surfaces while vanishing from /api/profile.json, which is exactly
  // the kind of surface-to-surface disagreement the single content
  // model exists to prevent.
  it('carries a project period through to the public projection', () => {
    const out = publicProjection({
      person: { email: 'a@b.co' },
      about: {},
      projects: [{ slug: 's', name: 'N', period: 'Apr 2020 - Jun 2020' }],
    })
    expect((out.projects as Record<string, unknown>[])[0].period).toBe('Apr 2020 - Jun 2020')
  })

  it('still drops an unrecognized project field (fail-closed preserved)', () => {
    // Guards the fix itself: adding `period` must not turn the
    // allowlist into a denylist.
    const out = publicProjection({
      person: { email: 'a@b.co' },
      about: {},
      projects: [{ slug: 's', name: 'N', internal_note: CANARY }],
    })
    expect((out.projects as Record<string, unknown>[])[0]).not.toHaveProperty('internal_note')
  })
})
