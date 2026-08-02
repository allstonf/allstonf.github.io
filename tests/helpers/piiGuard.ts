// tests/helpers/piiGuard.ts - the shared "no PII reaches a public
// artifact" guard, used by every public-artifact test in this repo.
//
// RED step taken (see tests/publicArtifactsPii.test.ts): with
// stripKnownPhoneShapedCollisions() as an identity function, running
// the six-artifact suite against REAL dist/ build output failed 3 of
// 12 tests, for the exact reason the task predicted: a
// "YYYY-MM - YYYY-MM" employment date range matches PHONE_SHAPED, so
// dist/index.md and dist/llms-full.txt failed, and dist/index.html
// failed on that SAME collision plus three more (a bare
// "YYYY-MM-DD" _meta.last_updated stamp, an SVG <polyline points="...">
// coordinate list, and a computed style="width:NN.NN%" bar-chart fill).
// The other three artifacts (llms.txt, resume.md, api/profile.json)
// and the canary/sanity checks passed even with the identity stub -
// confirmed empirically, not assumed. The implementation below is what
// turns that RED into GREEN, by stripping each named collision out of
// the TEXT rather than widening PHONE_SHAPED itself - see the
// docstring on stripKnownPhoneShapedCollisions() for why that
// direction is the one that keeps the guard fail-closed.
import { expect } from 'vitest'

/**
 * Phone-shaped: a run of 10+ digits/spaces/parens/dots/hyphens.
 * Deliberately blunt by SHAPE rather than by matching one specific
 * format, because a phone number can be typed a dozen ways ("(555)
 * 555-5555", "555.555.5555", "+1 555 555 5555") and a regex that only
 * recognizes one of them misses the rest. Unchanged from the original
 * guard in resumeMd.test.ts - moved here so it has exactly one home
 * instead of six copy-pasted literals.
 */
export const PHONE_SHAPED = /\+?\d[\d\s().-]{8,}\d/

/**
 * Street-address-shaped: "123 Main Street" and its common abbreviated
 * forms. Unchanged from the original guard in resumeMd.test.ts.
 */
export const STREET_ADDRESS_SHAPED = /\d+\s+\w+\s+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Blvd)\b/i

/**
 * Strip every KNOWN, NAMED legitimate collision with PHONE_SHAPED out of
 * `text`, so the shape check in assertNoPii() below can stay exactly as
 * blunt (and exactly as strict) as the original guard, instead of being
 * widened to carve out real content. Widening PHONE_SHAPED itself would
 * be the fail-open answer: a regex loosened to let a date range through
 * also lets through a real phone number formatted to look like one -
 * which is the one thing this guard exists to catch. Stripping the
 * known collision out of the TEXT, rather than out of the REGEX, keeps
 * the failure mode fail-closed: a leak that is NOT one of the named
 * patterns below still trips PHONE_SHAPED, exactly as before.
 *
 * Each pattern here is commented with the real, non-PII content it
 * exists to spare, and with which artifact(s) actually carry it, so a
 * future reader can tell "this is scoped to a known false positive"
 * from "this quietly widened the guard".
 */
export function stripKnownPhoneShapedCollisions(text: string): string {
  return (
    text
      // Employment date range: "2020-08 - 2022-06" (index.md,
      // llms-full.txt, index.html - all three render
      // formatDateRange()'s default " - " separator) or
      // "2022-07 to Present" (resume.md's RESUME_DATE_SEPARATOR, see
      // src/lib/agentSurface.ts). Stripping BOTH separator forms here,
      // rather than knowing which artifact uses which, is what lets one
      // shared helper cover all six artifacts without six copies of
      // this pattern each hardcoded to one separator.
      .replace(/\d{4}-\d{2}\s+(?:-|to)\s+(?:\d{4}-\d{2}|Present)/g, '')
      // A bare "YYYY-MM-DD" stamp: content/profile.json's
      // _meta.last_updated, rendered as VISIBLE text in index.html's
      // footer ("Last updated 2026-07-25") and again inside its
      // JSON-LD dateModified field. A single date is not a range, but
      // it is still exactly 10 digit/hyphen characters - long enough
      // to trip PHONE_SHAPED on its own, with no range needed.
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
      // SVG coordinate lists: <polyline points="6 9 12 15 18 9">. This
      // is the scroll-cue chevron icon's geometry - decorative markup,
      // not any person's contact information. Only index.html carries
      // inline SVG.
      .replace(/points="[\d\s.,-]+"/g, '')
      // Computed bar-chart fill widths: style="width:33.33333333333333%".
      // These were rendered by the Loop section (deleted 2026-07-31),
      // which turned a component weight (a plain float) into an inline
      // style attribute - not a contact detail. Kept as a harmless
      // no-op strip rule: nothing currently emits this shape, but it
      // costs nothing to leave in place if a future component ever
      // renders a percentage width inline again.
      .replace(/style="width:[\d.]+%"/g, '')
  )
}

/**
 * The shared assertion every public-artifact test calls: after
 * stripping every known legitimate collision (see
 * stripKnownPhoneShapedCollisions() above), `text` must contain
 * neither a phone-shaped run nor a street-address-shaped string. Used
 * identically across all six public artifacts (index.md, llms.txt,
 * llms-full.txt, resume.md, api/profile.json, index.html) so none of
 * them carries a copy-pasted pair of regexes - a single tested helper,
 * used six times, is the point of this file.
 *
 * The street-address check runs against the ORIGINAL `text`, never the
 * stripped copy: none of the known collisions above resemble a street
 * address, so there is nothing to spare it from, and checking the
 * original text keeps that half of the guard exactly as blunt as
 * resumeMd.test.ts's original version.
 */
export function assertNoPii(text: string): void {
  const strippedOfKnownCollisions = stripKnownPhoneShapedCollisions(text)
  expect(strippedOfKnownCollisions).not.toMatch(PHONE_SHAPED)
  expect(text).not.toMatch(STREET_ADDRESS_SHAPED)
}
