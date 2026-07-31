// tests/verifyContent.test.ts - the content gate's own tests.
//
// scripts/verify-content.mjs encodes rules that were previously prose in
// a plan document, where a future session could skip them, half-run
// them, or read past them. These tests are what make the encoding
// trustworthy: each one pins a rule to a concrete failing input, so the
// gate cannot quietly stop enforcing something.
import { describe, it, expect } from 'vitest'
import { checkContent } from '../scripts/verify-content.mjs'
import profile from '../content/profile.json'

describe('checkContent', () => {
  it('passes the real content model', () => {
    // The gate must agree with the shipped content model. If this fails,
    // either the model regressed or a rule is wrong - both need a human.
    expect(checkContent(profile)).toEqual({ ok: true, failures: [] })
  })

  it('fails a project with no period', () => {
    const r = checkContent({ projects: [{ slug: 'a', name: 'A' }] })
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('period')
  })

  it('fails a period in the PII-colliding numeric form', () => {
    // "2020-04 - 2020-06" matches PHONE_SHAPED in tests/helpers/piiGuard.ts.
    // Catching it HERE, at authoring time, beats catching it three tasks
    // later in the artifact suite where the fix is less obvious.
    const r = checkContent({
      projects: [{ slug: 'a', name: 'A', period: '2020-04 - 2020-06' }],
    })
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('phone-shaped')
  })

  it('accepts the month-name and bare-year period forms', () => {
    for (const period of ['Apr 2020 - Jun 2020', 'May 2019', '2026', 'April 2026']) {
      expect(checkContent({ projects: [{ slug: 'a', name: 'A', period }] }).ok).toBe(true)
    }
  })

  it('fails a banned claim anywhere in the model', () => {
    // Both of these shipped on a resume once and are false against the
    // actual repo, verified 2026-07-24 and 2026-07-28.
    for (const claim of ['LangChain', 'Perplexity API']) {
      const r = checkContent({
        projects: [{ slug: 'a', name: 'A', period: '2026', stack: [claim] }],
      })
      expect(r.ok).toBe(false)
      expect(r.failures.join(' ')).toContain(claim)
    }
  })

  it('fails a Waypoint link that overstates the static landing page', () => {
    const r = checkContent({
      projects: [
        {
          slug: 'waypoint',
          name: 'W',
          period: '2026',
          links: [{ label: 'Live demo', url: 'https://x.com' }],
        },
      ],
    })
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('Live demo')
  })

  it('does NOT ban a demo-ish label on a project that really is live', () => {
    // Scoping matters. research-vault-showcase genuinely ships a live
    // page and its link is labeled "Live". A global label ban would fail
    // the build on accurate content - the fail-open/fail-closed
    // reasoning runs the other way here, because the risk being guarded
    // is one specific overstatement about one specific private project.
    const r = checkContent({
      projects: [
        {
          slug: 'research-vault-showcase',
          name: 'R',
          period: '2026',
          links: [{ label: 'Live', url: 'https://x.com' }],
        },
      ],
    })
    expect(r.ok).toBe(true)
  })

  it('fails a duplicate slug', () => {
    const r = checkContent({
      projects: [
        { slug: 'a', name: 'A', period: '2026' },
        { slug: 'a', name: 'B', period: '2026' },
      ],
    })
    expect(r.ok).toBe(false)
    expect(r.failures.join(' ')).toContain('duplicate')
  })
})
