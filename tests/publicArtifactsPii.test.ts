// tests/publicArtifactsPii.test.ts - extends the PII guard from ONE
// public artifact (resumeMd.test.ts's original phone/address canaries)
// to all SIX this site publishes to a public URL with permanent git
// history: dist/index.md, dist/llms.txt, dist/llms-full.txt,
// dist/resume.md, dist/api/profile.json and dist/index.html.
//
// Reads real build output under dist/, the same pattern
// agentSurface.test.ts and parity.test.ts already use: run
// `npx astro build` before running this suite.
//
// Every real-build assertion below routes through
// tests/helpers/piiGuard.ts's assertNoPii(), so none of these six
// artifacts carries a copy-pasted pair of phone/address regexes - a
// single tested helper, used six times, is the point.

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import profile from '../content/profile.json'
import { renderIndexMd, renderLlmsFullTxt, renderLlmsTxt, renderResumeMd } from '../src/lib/agentSurface'
import { publicProjection } from '../src/lib/publicProjection'
import { assertNoPii, PHONE_SHAPED, STREET_ADDRESS_SHAPED, stripKnownPhoneShapedCollisions } from './helpers/piiGuard'

// A synthetic, obviously-fake phone number, never a real one - the
// same "canary, not withheld editorial content" rule
// publicProjection.test.ts's CANARY constant follows. Long enough
// (10 digit/hyphen characters, the same length as a bare YYYY-MM-DD
// date) to trip PHONE_SHAPED on its own.
const FAKE_PHONE = '+1 (555) 010-9999'

describe('every public artifact is guarded against a phone-shaped or street-address-shaped leak', () => {
  it('dist/resume.md (the original guard) still passes with the shared helper', () => {
    // Requirement: "keep the existing resumeMd assertions working."
    // resumeMd.test.ts keeps its own copy of this same assertion using
    // the shared helper directly; this is a second, redundant check
    // against the REAL build artifact (not just renderResumeMd()'s
    // in-memory output) so this file's six-artifact list is complete
    // and self-contained without having to cross-reference another
    // test file to confirm resume.md is covered.
    expect(existsSync('dist/resume.md')).toBe(true)
    assertNoPii(readFileSync('dist/resume.md', 'utf8'))
  })

  it('dist/index.md passes ONLY once the known date-range collision is stripped', () => {
    // THE TRAP: index.md keeps formatDateRange()'s default " - "
    // separator ("2020-08 - 2022-06"), and that exact string matches
    // PHONE_SHAPED. Verified empirically: with
    // stripKnownPhoneShapedCollisions() still an identity function (the
    // RED state), this assertion fails on real dist/index.md output
    // with three real date-range matches. assertNoPii() strips them
    // before checking, so this passes once the strip patterns are
    // implemented - never by widening PHONE_SHAPED itself.
    expect(existsSync('dist/index.md')).toBe(true)
    const text = readFileSync('dist/index.md', 'utf8')
    assertNoPii(text)
  })

  it('dist/llms.txt passes with no stripping needed - a legitimate "no change needed" outcome', () => {
    // llms.txt's body is the blockquote summary + Docs/Optional link
    // lists (see renderLlmsTxt() in src/lib/agentSurface.ts) - it never
    // renders a date range at all, so PHONE_SHAPED finds nothing to
    // strip here. Confirmed empirically against real dist/llms.txt: zero
    // phone-shaped matches even before stripKnownPhoneShapedCollisions()
    // was implemented. The canary test below proves this pass is not
    // vacuous.
    expect(existsSync('dist/llms.txt')).toBe(true)
    assertNoPii(readFileSync('dist/llms.txt', 'utf8'))
  })

  it('dist/llms-full.txt passes ONLY once the known date-range collision is stripped', () => {
    // llms-full.txt is mechanically derived from renderIndexMd() (see
    // agentSurface.ts's renderLlmsFullTxt()), so it carries the exact
    // same date-range trap as dist/index.md above and needs the exact
    // same strip.
    expect(existsSync('dist/llms-full.txt')).toBe(true)
    assertNoPii(readFileSync('dist/llms-full.txt', 'utf8'))
  })

  it('dist/api/profile.json passes with no stripping needed - a legitimate "no change needed" outcome', () => {
    // publicProjection() emits experience.start/experience.end as
    // separate, individually-quoted JSON string values
    // ("start": "2020-08", "end": "2022-06"), never concatenated into
    // one "2020-08 - 2022-06" run - the quotes, colon and newline
    // between them are not in PHONE_SHAPED's character class, so no
    // date-range collision is even possible in this artifact. Confirmed
    // empirically against real dist/api/profile.json: zero phone-shaped
    // matches. The canary test below proves this pass is not vacuous.
    expect(existsSync('dist/api/profile.json')).toBe(true)
    assertNoPii(readFileSync('dist/api/profile.json', 'utf8'))
  })

  it('dist/index.html passes ONLY once FOUR known legitimate collisions are stripped', () => {
    // index.html turned out to carry more legitimate collisions than
    // the task description's single named trap, found by running the
    // RED version of this suite against real dist/index.html and
    // reading every match PHONE_SHAPED reported:
    //   1. The same "2020-08 - 2022-06" date-range collision as
    //      index.md/llms-full.txt (index.astro's own formatDateRange()
    //      uses the identical " - " separator).
    //   2. A bare "2026-07-25" - _meta.last_updated, rendered as
    //      VISIBLE footer text AND inside the JSON-LD dateModified
    //      field. A single ISO date is not a range, but it is still
    //      exactly 10 digit/hyphen characters.
    //   3. <polyline points="6 9 12 15 18 9"> - the scroll-cue
    //      chevron's SVG coordinate list.
    //   4. style="width:33.33333333333333%" - the Loop section's
    //      component-weight bar-chart fill widths (that section was
    //      deleted 2026-07-31; the strip rule is a harmless no-op now).
    // All four are stripped by stripKnownPhoneShapedCollisions() (see
    // that function for the per-pattern rationale); none of the four
    // narrows PHONE_SHAPED itself, so a real phone number sitting
    // anywhere in this file - including right next to one of these
    // patterns - would still be caught. See the "does not eat a real
    // phone number" test below for the proof.
    expect(existsSync('dist/index.html')).toBe(true)
    const html = readFileSync('dist/index.html', 'utf8')
    assertNoPii(html)
  })

  it('stripKnownPhoneShapedCollisions does not eat a real phone number sitting next to every known collision at once', () => {
    // The meaningfulness proof for dist/index.html: since there is no
    // isolated renderIndexHtml(profile) function to call with a
    // poisoned in-memory profile (index.astro is compiled by Astro
    // directly from content/profile.json, which this task must not
    // modify), this test instead proves the STRIPPER itself is
    // fail-closed by construction - it removes exactly the four named
    // patterns and nothing else, so a real phone-shaped run adjacent to
    // (or between) all four still survives stripping and still trips
    // PHONE_SHAPED.
    const hostile =
      'points="6 9 12 15 18 9"> Reach me at +1 (555) 010-9999 or see 2020-08 - 2022-06 ' +
      'and this ran on 2026-07-25 with style="width:33.33333333333333%" applied.'
    const stripped = stripKnownPhoneShapedCollisions(hostile)
    expect(stripped).toMatch(PHONE_SHAPED)
    expect(stripped).toContain(FAKE_PHONE)
  })

  it('renderLlmsTxt DOES flag a phone-shaped leak - proves the "no change needed" pass above is not vacuous', () => {
    // Requirement: "prove the assertion is meaningful by temporarily
    // injecting a phone-shaped string into the content model, showing
    // the test goes red, and reverting." Rather than a manual,
    // throwaway demonstration, this is that same injection encoded as a
    // permanent regression test: a structuredClone of the real content
    // model (never content/profile.json itself, which this task must
    // not modify) with FAKE_PHONE injected into
    // agent_surface.llms_txt_guidance - the one free-prose field
    // renderLlmsTxt()'s header carries verbatim (see
    // buildLlmsHeaderLines() in src/lib/agentSurface.ts). If this
    // assertion ever stopped matching, that would mean PHONE_SHAPED (or
    // the renderer) silently stopped catching a real leak.
    const poisoned = structuredClone(profile) as any
    poisoned.agent_surface.llms_txt_guidance = `Reach me directly: ${FAKE_PHONE}`
    const text = renderLlmsTxt(poisoned)
    expect(text).toContain(FAKE_PHONE)
    expect(text).toMatch(PHONE_SHAPED)
  })

  it('publicProjection DOES flag a phone-shaped leak - proves the "no change needed" pass above is not vacuous', () => {
    // person.tagline is on PUBLIC_PERSON_FIELDS (see
    // src/lib/publicProjection.ts), so a phone-shaped string injected
    // there survives projection into the real public JSON shape.
    const poisoned = structuredClone(profile) as any
    poisoned.person.tagline = `Reach me directly: ${FAKE_PHONE}`
    const json = JSON.stringify(publicProjection(poisoned))
    expect(json).toContain(FAKE_PHONE.replace(/"/g, '\\"'))
    expect(json).toMatch(PHONE_SHAPED)
  })

  it('renderIndexMd and renderLlmsFullTxt DO flag a phone-shaped leak in an About paragraph', () => {
    // Covers both index.md AND llms-full.txt in one poisoning, since
    // renderLlmsFullTxt() is mechanically derived from renderIndexMd()
    // (see agentSurface.ts) - the same injection point proves both
    // artifacts' strip-then-check passes above are not vacuous.
    const poisoned = structuredClone(profile) as any
    poisoned.about = [`Reach me directly: ${FAKE_PHONE}`]
    const indexMd = renderIndexMd(poisoned)
    const llmsFullTxt = renderLlmsFullTxt(poisoned)
    expect(indexMd).toContain(FAKE_PHONE)
    expect(indexMd).toMatch(PHONE_SHAPED)
    expect(llmsFullTxt).toContain(FAKE_PHONE)
    expect(llmsFullTxt).toMatch(PHONE_SHAPED)
  })

  it('renderResumeMd DOES flag a phone-shaped leak in an About/tagline field', () => {
    // Rounds out the canary set to all six artifacts: resume.md's
    // tagline line carries person.tagline verbatim (see
    // renderResumeMd() in src/lib/agentSurface.ts).
    const poisoned = structuredClone(profile) as any
    poisoned.person.tagline = `Reach me directly: ${FAKE_PHONE}`
    const md = renderResumeMd(poisoned)
    expect(md).toContain(FAKE_PHONE)
    expect(md).toMatch(PHONE_SHAPED)
  })

  it('the street-address check still fires on all six real artifacts (sanity check, not a per-artifact regression risk)', () => {
    // STREET_ADDRESS_SHAPED never collided with any legitimate content
    // in this repo (no artifact renders a numbered-street line), so
    // there is nothing to strip for it - this is a plain sanity check
    // that the shared helper's second half runs against every real
    // artifact too, not just PHONE_SHAPED's.
    const artifacts = [
      'dist/index.md',
      'dist/llms.txt',
      'dist/llms-full.txt',
      'dist/resume.md',
      'dist/api/profile.json',
      'dist/index.html',
    ]
    for (const path of artifacts) {
      expect(readFileSync(path, 'utf8')).not.toMatch(STREET_ADDRESS_SHAPED)
    }
  })
})
