// tests/axeA11y.test.ts - runs axe-core against the REAL built HTML
// under dist/, not against source and not against a hand-written
// fixture. Same pattern as publicArtifactsPii.test.ts and
// parity.test.ts: run `npx astro build` before this suite.
//
// ============================================================
// SCOPE - what this suite does and does NOT catch. Read before
// trusting it, and do not widen these claims anywhere else.
// ============================================================
// CATCHES: structural and semantic accessibility defects that are
//   decidable from the DOM alone - invalid or contradictory ARIA,
//   an aria-* attribute not allowed on its element, missing form
//   labels, duplicate ids, missing document language, images with
//   no alt, list markup nesting, landmark and heading structure.
// DOES NOT CATCH - COLOR CONTRAST. jsdom has no layout or paint
//   engine, so axe's color-contrast rule cannot resolve a computed
//   background and returns `incomplete`, never pass or fail. This
//   suite therefore adds NOTHING to contrast coverage. Contrast on
//   this site is covered by tests/contrastRatios.test.ts and
//   tests/nonTextContrast.test.ts, which compute ratios from the
//   token values directly.
// DOES NOT CATCH - WCAG 1.4.10 REFLOW. Reflow is a judgment about
//   whether content is usable at 320 CSS px without two-dimensional
//   scrolling. An automated checker can flag symptoms (a fixed
//   width, a horizontal overflow) but cannot decide the criterion.
// DOES NOT CATCH - A NAV THAT VANISHES AT A BREAKPOINT WITH NO
//   HAMBURGER. This is not an accessibility-linter problem at all.
//   A media query that hides five links is valid, contrast-clean,
//   ARIA-clean markup; axe sees a header with nothing wrong in it.
//   That failure shipped through a full design and screenshot loop
//   on 2026-07-31, which is why the project requires a SCREENSHOT at
//   both sides of every nav breakpoint. Nothing here replaces that.

import { existsSync, readFileSync } from 'node:fs'
import { source as axeSource } from 'axe-core'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const BUILT_PAGE = 'dist/index.html'
const SITE_URL = 'https://allstonf.github.io/'

/**
 * Load `html` into a jsdom window, evaluate the axe-core source inside
 * that window, and run it. axe must be evaluated INSIDE the window
 * rather than imported into vitest's module scope, because it inspects
 * globals (document, getComputedStyle, Node) at call time; a
 * Node-scope import would analyze the wrong document.
 */
async function runAxe(html: string): Promise<any> {
  const dom = new JSDOM(html, { url: SITE_URL, runScripts: 'outside-only' })
  const win = dom.window as any
  win.eval(axeSource)
  return await win.axe.run(win.document)
}

/** One line per violation, so a CI failure names the rule, its impact
 * and the offending selector instead of dumping an unreadable object. */
function formatViolations(violations: any[]): string {
  return violations
    .map(
      (v) =>
        `${v.impact ?? 'unknown'}: ${v.id} - ${v.help} [${v.nodes.map((n: any) => n.target.join(' ')).join(', ')}]`,
    )
    .join('\n')
}

describe('axe-core structural accessibility check against built output', () => {
  it('dist/index.html has zero axe violations', async () => {
    expect(existsSync(BUILT_PAGE)).toBe(true)
    const results = await runAxe(readFileSync(BUILT_PAGE, 'utf8'))
    expect(formatViolations(results.violations)).toBe('')
  })

  it('the check is not vacuous - an injected aria-allowed-attr defect IS reported', async () => {
    const poisoned = readFileSync(BUILT_PAGE, 'utf8').replace(
      '</body>',
      '<a href="#x" aria-pressed="false">menu</a></body>',
    )
    const results = await runAxe(poisoned)
    expect(results.violations.map((v: any) => v.id)).toContain('aria-allowed-attr')
  })

  it('the check is not vacuous - an injected missing-alt image IS reported', async () => {
    // A second injected defect from a different rule family, so one
    // rule silently leaving axe's default set cannot make both canaries pass.
    const poisoned = readFileSync(BUILT_PAGE, 'utf8').replace('</body>', '<img src="/x.png"></body>')
    const results = await runAxe(poisoned)
    expect(results.violations.map((v: any) => v.id)).toContain('image-alt')
  })

  it('color-contrast is not decided under jsdom - documents the known blind spot', async () => {
    // Machine-checks the blind spot instead of only describing it. If a
    // future jsdom or axe version DOES resolve contrast, this goes red
    // and whoever sees it can delete it and the comment block, rather
    // than the repo continuing to claim contrast is uncovered when it
    // no longer is.
    const results = await runAxe(readFileSync(BUILT_PAGE, 'utf8'))
    expect((results.passes ?? []).map((p: any) => p.id)).not.toContain('color-contrast')
  })
})
