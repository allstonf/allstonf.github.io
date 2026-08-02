// tests/contrastRatios.test.ts - makes WCAG contrast a DERIVED, enforced
// property of tokens.css instead of a number someone wrote down.
//
// The failure mode this test exists to prevent: DESIGN.md once shipped a
// stated contrast ratio ("6.4:1 over the photographic scrim") that turned
// out to be unreproducible - an independent pixel sampling of the actual
// image measured 7.1:1 to 11.8:1 depending on region. A published spec
// carried a fabricated precision figure until a reviewer sampled the real
// pixels. DESIGN.md has since been corrected to say photo-band contrast
// "is not a fixed property and must be re-verified per image" rather than
// asserting a number (see DESIGN.md's Colors section) - this test suite
// covers the OTHER half of that claim: the flat-band pairs, where the
// background is a fixed, known color and a ratio really is a fixed,
// checkable property.
//
// Every color value below is PARSED out of tokens.css at test time, never
// hardcoded as a hex literal - so if a future edit changes --color-accent,
// --color-text-muted, etc., this test recomputes against the new value
// automatically instead of silently testing a stale color.
//
// Deliberately NOT covered: contrast over the photographic bands (hero,
// contact). That ratio is genuinely image-dependent and region-dependent;
// asserting a fixed number there would recreate exactly the defect this
// test file exists to prevent. See the report filed alongside this commit
// for a proposed follow-up (an image-sampling check, not a hardcoded
// number) if that coverage is wanted later.
//
// This suite covers WCAG 1.4.3 (text contrast, 4.5:1). Its sibling
// nonTextContrast.test.ts covers 1.4.11 (non-text contrast, 3:1) for
// interactive control boundaries; both share the same parsing and contrast
// math via tests/helpers/contrast.ts rather than each hand-rolling it.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compositeOver, contrastRatio, parseColor, readToken as readTokenFrom } from './helpers/contrast'

const css = readFileSync('src/styles/tokens.css', 'utf8')

/** Bind the shared readToken helper to this file's tokens.css snapshot. */
function readToken(name: string): string {
  return readTokenFrom(css, name)
}

// AA normal-text threshold (WCAG 2.x 1.4.3). Every pair below is used for
// normal-weight, non-large body/link/label text in tokens.css, so this is
// the correct bar for all of them - none qualifies for the lower 3:1
// large-text threshold.
const AA_NORMAL_TEXT = 4.5

describe('WCAG contrast ratios (computed from tokens.css, not asserted)', () => {
  const ground = parseColor(readToken('color-ground'))
  const accent = parseColor(readToken('color-accent'))

  // Each row is [pair name, foreground token, background token]. Extending
  // this list is how a new flat-band foreground/background pair gets
  // contrast-checked - no new boilerplate needed per pair.
  const pairs: Array<{ name: string; fgToken: string; bg: RgbaColor }> = [
    { name: 'body text (--color-text) on the ground', fgToken: 'color-text', bg: ground },
    {
      name: 'muted text (--color-text-muted) on the ground',
      fgToken: 'color-text-muted',
      bg: ground,
    },
    {
      name: 'accent (--color-accent), used for inline links in body copy, on the ground',
      fgToken: 'color-accent',
      bg: ground,
    },
    {
      name: 'ink-on-accent (--ink-on-accent), used for the skip link and hover-inverted resume button, on the accent fill',
      fgToken: 'ink-on-accent',
      bg: accent,
    },
  ]

  it.each(pairs)('$name clears AA normal text (4.5:1)', ({ fgToken, bg }) => {
    const rawFg = parseColor(readToken(fgToken))
    // Flatten a translucent foreground (e.g. text-muted's rgba alpha)
    // onto its background before measuring - a translucent color has no
    // contrast ratio of its own, only its composite does.
    const fg = rawFg.a === 1 ? rawFg : compositeOver(rawFg, bg)
    const ratio = contrastRatio(fg, bg)

    // The assertion message reports the actual computed number, so a
    // failure tells you the ratio rather than just "expected true" - this
    // is the property that would have caught the fabricated 6.4:1 figure
    // this test suite exists to prevent a recurrence of.
    expect(
      ratio,
      `computed contrast ratio is ${ratio.toFixed(2)}:1, below the ${AA_NORMAL_TEXT}:1 AA normal-text threshold`,
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  })
})
