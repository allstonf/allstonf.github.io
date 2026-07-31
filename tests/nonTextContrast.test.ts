// tests/nonTextContrast.test.ts - WCAG 2.1 SC 1.4.11 (Non-text Contrast):
// the visible boundary of a genuine, operable UI component (a native
// <button> a reader can click, an anchor styled as a toggle) must clear
// 3:1 against its background. This is the sibling of
// contrastRatios.test.ts's 4.5:1 text-contrast check for the boundary
// case, sharing its WCAG parsing and contrast math via
// tests/helpers/contrast.ts rather than reimplementing it.
//
// Scope: only the two boundaries that are actually a control's own
// affordance.
//   - The `button` base border, inherited un-overridden by the
//     LoopExplainer mode tabs and the walkthrough prev/next controls.
//   - `.topbar__view-toggle`'s resting border (the agent-view toggle).
//
// Deliberately NOT covered here: every other place --color-overlay-medium
// (or its replacement) appears - the nav's permanent border-bottom, the
// project-card left border, stack-item / badge / loop-verdict borders,
// the timeline rule, and the band__meta link underline. None of those is
// itself the clickable/focusable affordance of a control; they are
// dividers and decorative grouping chrome, so SC 1.4.11 does not bind
// them the way it binds an actual button edge. Brightening that token
// globally to satisfy this test would also have brightened all of that
// decorative chrome in a design whose stated palette philosophy is
// nearly monochrome and deliberately restrained - see the task report
// filed alongside this commit for the full per-use audit.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  parseColor,
  compositeOver,
  contrastRatio,
  readToken,
  readSelectorBorderToken,
} from './helpers/contrast'

const css = readFileSync('src/styles/tokens.css', 'utf8')

// WCAG 2.1 SC 1.4.11's threshold for the visual boundary of a UI component.
const NON_TEXT_CONTRAST = 3

describe('WCAG non-text contrast (SC 1.4.11): interactive control boundaries', () => {
  const ground = parseColor(readToken(css, 'color-ground'))

  // Each row names a real, currently-shipped selector. The test reads
  // whichever token that selector's border ACTUALLY references today (see
  // readSelectorBorderToken), so a future edit that quietly points the
  // border back at a token below 3:1 fails here instead of passing against
  // a stale assumption of "which token is wired in."
  const boundaries: Array<{ name: string; selector: string }> = [
    {
      name: 'button base border (LoopExplainer mode tabs, walkthrough prev/next controls)',
      selector: 'button',
    },
    {
      name: '.topbar__view-toggle border at rest',
      selector: '.topbar__view-toggle',
    },
  ]

  it.each(boundaries)('$name clears the 3:1 non-text-contrast threshold', ({ selector }) => {
    const tokenName = readSelectorBorderToken(css, selector)
    const rawFg = parseColor(readToken(css, tokenName))
    // Flatten a translucent border color onto the ground before measuring,
    // same reasoning as contrastRatios.test.ts: a translucent color has no
    // contrast ratio of its own, only its composite over what's behind it.
    const fg = rawFg.a === 1 ? rawFg : compositeOver(rawFg, ground)
    const ratio = contrastRatio(fg, ground)

    // The assertion message reports the actual computed ratio and the
    // token it came from, so a failure tells you exactly which token to
    // fix rather than just "expected true".
    expect(
      ratio,
      `"${selector}" border token --${tokenName} computes ${ratio.toFixed(2)}:1 against the ` +
        `ground, below the ${NON_TEXT_CONTRAST}:1 SC 1.4.11 non-text-contrast threshold`,
    ).toBeGreaterThanOrEqual(NON_TEXT_CONTRAST)
  })
})
