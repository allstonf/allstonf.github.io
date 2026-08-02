import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// DESIGN.md is the published spec for this site's visual language. If the
// stylesheet drifts from it, anyone who reuses the file gets a design that
// does not match what they saw. These tests pin the load-bearing tokens,
// then generalize the pin so a FUTURE token added to (or dropped from)
// DESIGN.md is caught automatically instead of needing a new hand-written
// test every time.
describe('DESIGN.md agrees with the stylesheet', () => {
  const design = readFileSync('DESIGN.md', 'utf8')
  const css = readFileSync('src/styles/tokens.css', 'utf8')

  // Split the file into its YAML frontmatter and its prose body. Both
  // halves get used below: the frontmatter is parsed into a real object
  // so tests can walk every declared token, and the prose is scanned for
  // {path.to.token} cross-references.
  const frontmatterMatch = design.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!frontmatterMatch) {
    throw new Error('DESIGN.md is missing a --- frontmatter block')
  }
  const [, frontmatterText, body] = frontmatterMatch

  // A minimal indent-based parser for DESIGN.md's specific frontmatter
  // shape: scalar leaves, up to a few levels of 2-space nesting, and one
  // folded `description: >` block whose continuation lines never match
  // the `key: value` pattern below and are silently skipped. js-yaml is
  // only a transitive dependency of this project (pulled in by Astro),
  // not a declared one, so this hand-rolls the narrow shape DESIGN.md
  // actually uses rather than reaching for an undeclared package.
  function parseFrontmatter(text: string): Record<string, unknown> {
    const root: Record<string, unknown> = {}
    const stack: { indent: number; node: Record<string, unknown> }[] = [{ indent: -1, node: root }]

    for (const line of text.split('\n')) {
      const match = line.match(/^(\s*)([A-Za-z0-9_]+):\s*(.*)$/)
      if (!match) continue // blank lines and folded-scalar continuation lines

      const [, indentStr, key, rawValue] = match
      const indent = indentStr.length

      // Pop back to the nearest ancestor before writing this key, so a
      // dedent (e.g. from typography.display.* back to typography.body)
      // lands in the right parent object.
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop()
      }
      const parent = stack[stack.length - 1].node

      if (rawValue === '' || rawValue === '>') {
        // Empty value or a folded-scalar marker: this key introduces a
        // nested block, so descend into a new object.
        const child: Record<string, unknown> = {}
        parent[key] = child
        stack.push({ indent, node: child })
      } else {
        parent[key] = rawValue.replace(/^"(.*)"$/, '$1')
      }
    }

    return root
  }

  const frontmatter = parseFrontmatter(frontmatterText)

  // The two accent hexes are the system's only chromatic colors and the
  // ones most load-bearing for reuse: get either wrong and every
  // interactive-element cue in a derived design is the wrong color.
  const TOKENS = ['#42DCA3', '#1d9b6c']

  it.each(TOKENS)('declares %s in both DESIGN.md and tokens.css', (hex) => {
    expect(design.toLowerCase()).toContain(hex.toLowerCase())
    expect(css.toLowerCase()).toContain(hex.toLowerCase())
  })

  it('documents #fcfcfc as dead CSS excluded from the token set, not a live token', () => {
    // #fcfcfc is NOT a "both files" case like the two tokens above, and
    // asserting it that way would be wrong: it only ever appeared in
    // grayscale.css's ::selection/::-moz-selection rules (verified
    // against grayscale.css lines 296-305 in this repo), immediately
    // overridden on the following line by
    // `background: rgba(255, 255, 255, 0.2)` within the same rule, so it
    // never actually painted in any browser. DESIGN.md's Colors section
    // says so explicitly ("it is not carried into the token set below
    // for that reason"), and tokens.css correctly has no ::selection
    // rule and no #fcfcfc anywhere. This test pins BOTH halves of that
    // invariant, so it catches a regression in either direction: the
    // honesty note quietly disappearing from DESIGN.md, or #fcfcfc
    // quietly becoming a real, live token in the stylesheet again.
    expect(design.toLowerCase()).toContain('#fcfcfc')
    expect(design).toMatch(/not carried into the token set/)
    expect(css.toLowerCase()).not.toContain('#fcfcfc')
  })

  it('names both self-hosted families in both files', () => {
    for (const family of ['Montserrat', 'Lora']) {
      expect(design).toContain(family)
      expect(css).toContain(family)
    }
  })

  it('carries all eight spec sections', () => {
    for (const section of [
      '## Overview',
      '## Colors',
      '## Typography',
      '## Layout',
      '## Elevation',
      '## Shapes',
      '## Components',
      '## Do',
    ]) {
      expect(design).toContain(section)
    }
  })

  it('never references a font CDN, since the page must make zero external requests', () => {
    expect(design).not.toMatch(/fonts\.googleapis|fonts\.gstatic/)
    expect(css).not.toMatch(/fonts\.googleapis|fonts\.gstatic/)
  })

  it('carries every colors.* frontmatter token into tokens.css', () => {
    // Stronger than the two pinned hexes above: this walks the WHOLE
    // colors block, so a token added to DESIGN.md later but never wired
    // into the stylesheet fails here without needing a new hand-written
    // test. Values are compared with whitespace stripped because
    // DESIGN.md writes rgba() compactly ("rgba(255,255,255,0.8)") while
    // tokens.css writes it with the conventional space after each comma
    // - the same color under different formatting, not a real mismatch.
    const colors = frontmatter.colors as Record<string, string> | undefined
    expect(colors, 'expected a colors: block in DESIGN.md frontmatter').toBeTruthy()
    const colorEntries = Object.entries(colors ?? {})
    expect(colorEntries.length).toBeGreaterThan(0)

    const cssCompact = css.toLowerCase().replace(/\s+/g, '')
    for (const [key, rawValue] of colorEntries) {
      const valueCompact = rawValue.toLowerCase().replace(/\s+/g, '')
      expect(cssCompact, `expected colors.${key} (${rawValue}) to appear in tokens.css`).toContain(valueCompact)
    }
  })

  it('has no dangling {path.to.token} cross-reference in the prose', () => {
    // A removed or renamed token is exactly how a dangling reference
    // gets created - DESIGN.md previously shipped a fabricated
    // typography.scale.h2 value that a review had to remove. Every
    // {a.b.c} placeholder in the prose below the frontmatter must
    // resolve to a real frontmatter key, so a future removal like that
    // one is caught here instead of shipping a broken reference.
    const refs = [...body.matchAll(/\{([a-zA-Z0-9_.]+)\}/g)].map((m) => m[1])
    expect(refs.length, 'expected DESIGN.md prose to use at least one {token} reference').toBeGreaterThan(0)

    for (const ref of refs) {
      const resolved = ref.split('.').reduce<unknown>((node, segment) => {
        return node && typeof node === 'object' ? (node as Record<string, unknown>)[segment] : undefined
      }, frontmatter)
      expect(resolved, `dangling reference {${ref}} has no matching frontmatter key`).not.toBeUndefined()
    }
  })
})
