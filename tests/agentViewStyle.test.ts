// tests/agentViewStyle.test.ts - guards the two style invariants the
// agent view depends on for its credibility as a "source" view.
//
// Both are the kind of defect that renders without erroring: a CSS
// custom property that was never defined resolves to nothing and the
// declaration is simply dropped, so the page still looks fine at a
// glance while the element silently inherits the wrong face.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/styles/tokens.css', 'utf8')

/** Extract the declaration block of a single top-level rule. */
function ruleBlock(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `expected a ${selector} rule in tokens.css`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('agent view typography', () => {
  it('renders the markdown source in the mono token', () => {
    // A markdown SOURCE view set in a proportional face is a
    // credibility tell: the view's whole claim is that it shows the
    // raw text an agent receives.
    expect(ruleBlock('pre.agent-view')).toMatch(/font-family:\s*var\(--font-mono\)/)
  })

  it('defines every font token it references', () => {
    // The trap this catches: --font-mono did not exist when
    // pre.agent-view first reached for it. An undefined custom
    // property makes the browser DROP the declaration, so the element
    // would have fallen back to an inherited proportional face while
    // the stylesheet looked correct.
    const referenced = [...css.matchAll(/var\((--font-[\w-]+)\)/g)].map((m) => m[1])
    expect(referenced.length).toBeGreaterThan(0)
    for (const token of new Set(referenced)) {
      expect(css, `${token} is used but never defined`).toMatch(
        new RegExp(`\\s${token}:\\s*[^;]+;`),
      )
    }
  })
})
