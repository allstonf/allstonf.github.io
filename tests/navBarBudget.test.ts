// tests/navBarBudget.test.ts - the header row must fit at 320px.
//
// A budget comment in tokens.css tracked this row's total width and was
// used to justify the 480px breakpoint. On 2026-07-31 a hamburger (44px)
// and a gap were added to the row and that comment was not updated, so
// the row overflowed; because .site-nav-bar__inner is
// justify-content: flex-end, the overflow went off the LEFT edge and
// clipped the hamburger - the only navigation control at that width.
// A UX review measured the button at x = -25.4px, 19 of 44px visible.
//
// A comment cannot fail a build. This test can.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Intrinsic content widths, from the tokens.css budget comment. These
// only change if the labels themselves change.
const BRAND = 141.9
const RESUME = 91.5
const AGENT_TOGGLE = 126.3
const HAMBURGER = 44

/** Read a px value for a custom property out of tokens.css :root. */
function token(name: string): number {
  const css = readFileSync('src/styles/tokens.css', 'utf8')
  const rem = new RegExp(`--${name}:\\s*([0-9.]+)rem`).exec(css)
  if (rem) return parseFloat(rem[1]) * 16
  const px = new RegExp(`--${name}:\\s*([0-9.]+)px`).exec(css)
  if (!px) throw new Error(`token --${name} not found in tokens.css`)
  return parseFloat(px[1])
}

describe('header row fits without clipping the hamburger', () => {
  const gap = token('space-1')

  it('fits at 320px with the brand hidden', () => {
    // padding + hamburger + gap + resume + gap + toggle + padding
    const total = gap * 2 + HAMBURGER + gap + RESUME + gap + AGENT_TOGGLE
    expect(total).toBeLessThanOrEqual(320)
  })

  it('fits at 480px with the brand shown', () => {
    const total =
      gap * 2 + BRAND + gap + HAMBURGER + gap + RESUME + gap + AGENT_TOGGLE
    expect(total).toBeLessThanOrEqual(480)
  })

  it('the tokens.css budget comment accounts for the hamburger', () => {
    // The regression was a stale comment nobody was forced to update.
    // Pin it: if the comment states a budget, it must name every item
    // actually in the row.
    const css = readFileSync('src/styles/tokens.css', 'utf8')
    // Cap is generous on purpose: the comment grew to ~800 chars when
    // the hamburger and its rationale were added, and a tight cap made
    // this test fail for a reason that had nothing to do with the code.
    const budgetComment = /Stage 2 of the collapse[\s\S]{0,2000}?\*\//.exec(css)
    expect(budgetComment, 'budget comment not found').not.toBeNull()
    expect(budgetComment![0].toLowerCase()).toContain('hamburger')
  })

  it('the compact narrow-width block exists and halves the gap', () => {
    // Guards the fix itself: the arithmetic above only holds because a
    // max-width block drops the row to --space-1.
    const css = readFileSync('src/styles/tokens.css', 'utf8')
    const block = /@media \(max-width: 519px\)[\s\S]{0,600}?\n\}/.exec(css)
    expect(block, 'max-width: 519px block not found').not.toBeNull()
    expect(block![0]).toContain('.site-nav-bar__inner')
    expect(block![0]).toContain('var(--space-1)')
  })
})
