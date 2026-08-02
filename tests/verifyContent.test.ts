// tests/verifyContent.test.ts - the content gate's own tests.
//
// scripts/verify-content.mjs encodes rules that were previously prose in
// a plan document, where a future session could skip them, half-run
// them, or read past them. These tests are what make the encoding
// trustworthy: each one pins a rule to a concrete failing input, so the
// gate cannot quietly stop enforcing something.
import { describe, expect, it } from 'vitest'
import profile from '../content/profile.json'
import { checkContent, classifyUrlStatus } from '../scripts/verify-content.mjs'

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

describe('classifyUrlStatus', () => {
  // Added 2026-07-31 after the gate failed a clean build on
  // https://www.linkedin.com/in/allston-fojas returning 999. The same
  // URL had returned 200 hours earlier in the same session, so a flaky
  // third party could fail the build on correct content - the exact
  // "fail-closed scoped too wide" failure recorded that morning.
  it('treats 200 as ok', () => {
    expect(classifyUrlStatus(200)).toBe('ok')
  })

  it('treats LinkedIn 999 as blocked, not dead', () => {
    // 999 is not a real HTTP status. It is LinkedIn's anti-automation
    // response. The page is fine in a browser.
    expect(classifyUrlStatus(999)).toBe('blocked')
  })

  it('treats 429 as blocked, since rate limiting is transient', () => {
    expect(classifyUrlStatus(429)).toBe('blocked')
  })

  it('still FAILS a genuinely dead link', () => {
    for (const code of [404, 410, 500]) {
      expect(classifyUrlStatus(code)).toBe('dead')
    }
  })

  it('still FAILS 403 - on a portfolio that usually means a private repo', () => {
    // Deliberately NOT lumped in with the bot-blocks: a 403 on a link a
    // recruiter is meant to click is a real defect worth failing on.
    expect(classifyUrlStatus(403)).toBe('dead')
  })

  it('treats a network error (0) as BLOCKED, not dead', () => {
    // REVERSED after code review 2026-07-31. 0 is what the CLI's catch
    // handler produces for ANY thrown fetch: DNS blip, timeout, TLS
    // reset, connection refused. Bucketing it with 404/410/500 meant a
    // transient network failure on a perfectly live URL failed the
    // build - the identical failure class the 999 fix was written to
    // remove, reintroduced through the exception path.
    //
    // Reproduced before fixing: fetching an unresolvable host threw,
    // was caught as 0, and classified 'dead'.
    //
    // The checker cannot distinguish "the target is dead" from "my own
    // network call failed", so it must not assert the former.
    expect(classifyUrlStatus(0)).toBe('blocked')
  })
})

describe('retraction gate on about[] prose', () => {
  it('fails when a retracted claim reappears in an about paragraph', () => {
    const poisoned = {
      ...profile,
      about: [...profile.about, 'Where the data is personal, I keep the inference local.'],
    }
    const result = checkContent(poisoned)
    expect(result.ok).toBe(false)
    expect(result.failures.join('\n')).toMatch(/retracted claim/i)
  })

  it('fails when a retracted claim reappears in a project summary', () => {
    // Same banned list, both surfaces - a retraction is equally wrong
    // wherever it lands.
    const poisoned = {
      ...profile,
      projects: profile.projects.map((p, i) =>
        i === 0 ? { ...p, summary: 'Signed a lease on the property it ranked first.' } : p,
      ),
    }
    expect(checkContent(poisoned).ok).toBe(false)
  })

  it('passes on the real content model', () => {
    // The corrections from Task 1 must satisfy the gate they motivated.
    expect(checkContent(profile).failures).toEqual([])
  })

  it('does not fire on prose that merely mentions a banned SUBSTRING in context', () => {
    // Fail-closed is the right default, but a match this broad would fail
    // the build on correct content. "ranked" alone is legitimate: the
    // system genuinely does rank listings.
    const fine = { ...profile, about: [...profile.about, 'It ranked them with a commute engine.'] }
    expect(checkContent(fine).ok).toBe(true)
  })

  it('does not fire on an accurate, narrowly-scoped local-inference sentence', () => {
    // The retracted claim was false because it was UNIVERSAL, not because of
    // the words. A correct future rewrite must not fail the build.
    const fine = {
      ...profile,
      about: [
        ...profile.about,
        'For the journal query path specifically, I keep the inference local; ' +
          'the broader orchestration calls out to cloud models.',
      ],
    }
    expect(checkContent(fine).ok).toBe(true)
  })

  it('still fails on the literal withdrawn clause', () => {
    // The needle must remain wide enough to catch a straight copy-paste of
    // the original overstated sentence, even after being narrowed to avoid
    // blocking the accurate rewording above.
    const poisoned = {
      ...profile,
      about: [...profile.about, 'Where the data is personal, I keep the inference local.'],
    }
    expect(checkContent(poisoned).ok).toBe(false)
  })

  it('catches a retracted claim at a sentence boundary regardless of capitalization', () => {
    // The most natural way a retracted claim reappears is at the START of a
    // sentence, capitalized. A case-sensitive needle misses exactly that.
    const poisoned = {
      ...profile,
      about: [...profile.about, 'The property it ranked first was later reconsidered after a manual walkthrough.'],
    }
    expect(checkContent(poisoned).ok).toBe(false)
  })
})

describe('the gate covers every prose surface, not just projects and about', () => {
  it('catches a retracted claim in an experience bullet', () => {
    // experience[] bullets are public prose on all six surfaces. The scan
    // comment claimed a whole-model reach it did not have.
    const poisoned = {
      ...profile,
      experience: profile.experience.map((job, i) =>
        i === 0 ? { ...job, bullets: [...job.bullets, 'Signed a lease on the property it ranked first.'] } : job,
      ),
    }
    expect(checkContent(poisoned).ok).toBe(false)
  })

  it('catches a banned claim in an experience bullet', () => {
    const poisoned = {
      ...profile,
      experience: profile.experience.map((job, i) =>
        i === 0 ? { ...job, bullets: [...job.bullets, 'Built the pipeline on LangChain.'] } : job,
      ),
    }
    expect(checkContent(poisoned).ok).toBe(false)
  })

  it('catches a retracted claim in person.tagline', () => {
    const poisoned = {
      ...profile,
      person: { ...profile.person, tagline: 'Where the data is personal, I keep the inference local' },
    }
    expect(checkContent(poisoned).ok).toBe(false)
  })

  it('still passes on the real, unmodified content model', () => {
    // Widening the scan must not fail the build on correct content - the
    // failure mode this branch already had one fix round for.
    expect(checkContent(profile).failures).toEqual([])
  })
})
