// tests/helpers/contrast.ts
//
// Shared WCAG 2.x contrast-ratio math, extracted from contrastRatios.test.ts
// so a second suite (nonTextContrast.test.ts, covering SC 1.4.11's 3:1
// non-text threshold) can derive ratios from the same tokens.css source
// instead of hand-rolling a second, parallel implementation of the same
// color math. Every function here is pure and takes its inputs explicitly
// (no hidden file reads, no module-level state) so each caller stays in
// control of which stylesheet string it is testing against.

/** An RGB color in 0-255 channels plus an alpha in [0, 1]. */
export interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

/**
 * Pull a single custom-property's raw value out of a tokens.css source
 * string. Reads the FIRST `--name: value;` declaration for the given token
 * name. tokens.css declares every color token exactly once inside :root, so
 * "first" is unambiguous here; this is a test-only convenience, not a
 * general CSS parser.
 */
export function readToken(css: string, name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`))
  if (!match) {
    throw new Error(`expected tokens.css to declare --${name}`)
  }
  return match[1].trim()
}

/**
 * Parse a CSS color literal as it actually appears in tokens.css: either
 * a 6-digit hex (`#42dca3`) or an `rgba(r, g, b, a)` function. Opaque hex
 * colors get a=1 so callers can composite uniformly regardless of which
 * form the token used.
 */
export function parseColor(value: string): RgbaColor {
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

  const rgbaMatch = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
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
export function compositeOver(fg: RgbaColor, bg: RgbaColor): RgbaColor {
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
export function linearizeChannel(channel255: number): number {
  const c = channel255 / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.x relative luminance: the 0.2126/0.7152/0.0722 weighted sum. */
export function relativeLuminance(color: RgbaColor): number {
  return 0.2126 * linearizeChannel(color.r) + 0.7152 * linearizeChannel(color.g) + 0.0722 * linearizeChannel(color.b)
}

/**
 * WCAG 2.x contrast ratio between two opaque colors: (L1 + 0.05) / (L2 +
 * 0.05), with L1 the lighter of the two luminances. Order of the two
 * arguments does not matter - the max/min below normalizes it - which
 * matters because "foreground on background" and "background on
 * foreground" must report the same ratio.
 */
export function contrastRatio(a: RgbaColor, b: RgbaColor): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Find the FIRST bare rule block for an exact CSS selector (e.g. "button" or
 * ".topbar__view-toggle") and return the name of the color token its
 * border declaration references.
 *
 * This exists so a non-text-contrast test asserts against whichever token
 * the rule ACTUALLY uses today, rather than a hardcoded assumption of which
 * token is wired in. If a future edit swaps the border back to a token
 * that fails 3:1, this reads the real CSS and the computed ratio catches
 * the regression instead of silently passing against a stale assumption.
 *
 * Matches only a bare `SELECTOR {` block (only whitespace between the
 * selector text and the brace - no combinator or pseudo-class), so
 * `button:hover {` or `.topbar__view-toggle::before {` are never mistaken
 * for the base/resting rule.
 */
export function readSelectorBorderToken(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blockMatch = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  if (!blockMatch) {
    throw new Error(`expected tokens.css to declare a bare "${selector} { }" rule`)
  }
  const block = blockMatch[1]
  const borderMatch = block.match(/border(?:-color)?:\s*[^;]*var\(--([a-zA-Z0-9-]+)\)/)
  if (!borderMatch) {
    throw new Error(`expected a border declaration referencing a var(--token) inside "${selector} { }"`)
  }
  return borderMatch[1]
}
