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

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/styles/tokens.css', 'utf8')

/**
 * Pull a single custom-property's raw value out of tokens.css.
 *
 * Reads the FIRST `--name: value;` declaration for the given token name.
 * tokens.css declares every color token exactly once inside :root, so
 * "first" is unambiguous here; this is a test-only convenience, not a
 * general CSS parser.
 */
function readToken(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`))
  if (!match) {
    throw new Error(`expected tokens.css to declare --${name}`)
  }
  return match[1].trim()
}

/** An RGB color in 0-255 channels plus an alpha in [0, 1]. */
interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

/**
 * Parse a CSS color literal as it actually appears in tokens.css: either
 * a 6-digit hex (`#42dca3`) or an `rgba(r, g, b, a)` function. Opaque hex
 * colors get a=1 so callers can composite uniformly regardless of which
 * form the token used.
 */
function parseColor(value: string): RgbaColor {
  const hexMatch = value.match(/^#([0-9a-fA-F]{6})$/)
  if (hexMatch) {
    const hex = hexMatch[1]
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    }
  }

  const rgbaMatch = value.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/,
  )
  if (rgbaMatch) {
    const [, r, g, b, a] = rgbaMatch
    return {
      r: Number(r),
      g: Number(g),
      b: Number(b),
      a: a === undefined ? 1 : Number(a),
    }
  }

  throw new Error(`unrecognized color literal: "${value}" (expected #rrggbb or rgba())`)
}

/**
 * Alpha-composite a (possibly translucent) foreground over an opaque
 * background, per the standard "over" operator: result = fg*a + bg*(1-a).
 * A translucent token like --color-text-muted (rgba(255,255,255,0.8))
 * cannot have its own contrast ratio in isolation - what a reader actually
 * sees is this composite - so every translucent token gets flattened here
 * before luminance is computed. Throws if the background itself is
 * translucent, since compositing onto an unresolved background would
 * silently produce a meaningless color.
 */
function compositeOver(fg: RgbaColor, bg: RgbaColor): RgbaColor {
  if (bg.a !== 1) {
    throw new Error('compositeOver requires an opaque background (bg.a must be 1)')
  }
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  }
}

/**
 * WCAG 2.x linearization of a single sRGB channel (0-255 in, 0-1 out).
 * The 0.03928 threshold and the two branches below are the spec's exact
 * piecewise definition, not an approximation - see
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance.
 */
function linearizeChannel(channel255: number): number {
  const c = channel255 / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** WCAG 2.x relative luminance: the 0.2126/0.7152/0.0722 weighted sum. */
function relativeLuminance(color: RgbaColor): number {
  return (
    0.2126 * linearizeChannel(color.r) +
    0.7152 * linearizeChannel(color.g) +
    0.0722 * linearizeChannel(color.b)
  )
}

/**
 * WCAG 2.x contrast ratio between two opaque colors: (L1 + 0.05) / (L2 +
 * 0.05), with L1 the lighter of the two luminances. Order of the two
 * arguments does not matter - the max/min below normalizes it - which
 * matters because "foreground on background" and "background on
 * foreground" must report the same ratio.
 */
function contrastRatio(a: RgbaColor, b: RgbaColor): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
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
