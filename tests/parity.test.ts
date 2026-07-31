import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import profile from '../content/profile.json'

describe('static shell parity with v1', () => {
  const html = readFileSync('dist/index.html', 'utf8')

  it('names Apple as the current employer in VISIBLE text', () => {
    // JSON-LD alone provably fails; the visible line is the load-bearing fix.
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, '')
    expect(visible).toContain(profile.person.current_role.employer)
  })

  it('names the education institution in VISIBLE text', () => {
    // Mirrors the employer test above: person.education is rendered as
    // a visible <dd> in the header meta record (index.astro:180-195),
    // not just inside the JSON-LD alumniOf block, for the same reason
    // the current-role line is visible - JSON-LD-only data is invisible
    // to the AI agents the controlled test in index.astro's header
    // comment checked. This guards against a future edit silently
    // dropping or hiding that <dd> while every other test stays green.
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, '')
    expect(visible).toContain(profile.person.education.institution)
  })

  it('shows a visible last-updated date sourced from _meta.last_updated', () => {
    // Freshness is a measured citation factor (30-89 days old is the
    // observed sweet spot), and it has to be VISIBLE text, not just the
    // JSON-LD dateModified value - the same "structured data alone is
    // invisible to the agents that matter" reasoning as the visible
    // current-role line above.
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, '')
    expect(visible).toContain(profile._meta.last_updated)
  })

  it('states role and employer plainly in the meta description', () => {
    const description = html.match(/<meta name="description" content="([^"]*)"/)
    expect(description, 'expected a <meta name="description"> tag').not.toBeNull()
    expect(description![1]).toContain(profile.person.current_role.employer)
  })

  it('renders every about paragraph', () => {
    for (const para of profile.about) {
      expect(html).toContain(para.slice(0, 40))
    }
  })

  it('renders every project name', () => {
    for (const p of profile.projects) {
      expect(html).toContain(p.name)
    }
  })

  it('ships no em-dash', () => {
    // Built from its char code (U+2014 = 8212) rather than typed as a
    // literal character, so this test file itself contains zero
    // em-dash bytes, per the standing "no em-dashes anywhere - code,
    // comments, copy, commit messages" style rule. Identical runtime
    // behavior to the literal character.
    expect(html).not.toContain(String.fromCharCode(8212))
  })

  it('ships a favicon that actually resolves on disk', () => {
    // v1's index.html carries <link rel="icon" ...>. A regression here
    // was caught by review round 1: the <link> tag alone is not enough
    // to assert, because a tag pointing at a file the build never
    // copied is exactly the failure mode that shipped - the browser
    // tab silently falls back to the generic icon with no build error.
    // So this test checks BOTH halves: the tag exists, AND the file it
    // points at exists under dist/ after a real build.
    const match = html.match(/<link\s+rel="icon"[^>]*href="([^"]+)"/)
    expect(match, 'expected a <link rel="icon" ...> tag in dist/index.html').not.toBeNull()

    const href = match![1]
    // href is root-relative ("/favicon.svg") because this is a user
    // site served from the domain root (base: '/'), so it maps
    // directly onto a path under dist/ with the leading slash dropped.
    const distPath = join('dist', href.replace(/^\//, ''))
    expect(existsSync(distPath), `expected ${distPath} to exist after astro build`).toBe(true)
  })

  it('ships the markdown-twin link as a real anchor, so it works without JS', () => {
    // The toggle is progressive enhancement. If a future edit turns it
    // into a <button>, a scripting-disabled reader loses the agent view
    // entirely and every other test still passes.
    expect(html).toMatch(/<a[^>]*data-view-toggle[^>]*href="\/index\.md"/)
  })

  it('ships the toggle anchor with no aria-pressed and no role', () => {
    // axe-core rule aria-allowed-attr, impact critical: aria-pressed is
    // not permitted on the implicit role=link of an <a href>. Shipping
    // it in the static HTML put a real WCAG violation on the page and
    // into Lighthouse's accessibility category.
    //
    // Button semantics are applied by initViewToggle at runtime instead
    // (see tests/viewToggle.test.ts). The script only runs when JS is
    // on, which is exactly when the element behaves as a button, so the
    // no-JS reader gets a clean valid link and the JS reader gets valid
    // toggle semantics. This test is the guard that stops the violation
    // from being reintroduced in the markup.
    const match = html.match(/<a[^>]*data-view-toggle[^>]*>/)
    expect(match, 'expected the view-toggle anchor in dist/index.html').not.toBeNull()
    expect(match![0]).not.toMatch(/aria-pressed/)
    expect(match![0]).not.toMatch(/\brole\s*=/)
  })

  it('labels the toggle with a constant label, so no state depends on the text', () => {
    // The label does not swap between states. State is carried by the
    // dot, the border, and aria-pressed, which means the control has
    // exactly one width by construction and needs no reserved box.
    const match = html.match(/<a[^>]*data-view-toggle[^>]*>([\s\S]*?)<\/a>/)
    expect(match, 'expected the view-toggle anchor in dist/index.html').not.toBeNull()
    expect(match![1].trim()).toBe('agent view')
  })

  it('ships a live region so the view swap is announced to screen readers', () => {
    // Toggling replaces the entire contents of <main>. Without a live
    // region that swap happens with zero announcement. The region has
    // to live OUTSIDE [data-view-target] or it is destroyed by the very
    // swap it exists to announce.
    expect(html).toMatch(/<[^>]*data-view-status[^>]*role="status"|role="status"[^>]*data-view-status/)
    const mainStart = html.indexOf('data-view-target')
    const statusAt = html.indexOf('data-view-status')
    expect(statusAt, 'expected a data-view-status live region').toBeGreaterThan(-1)
    expect(statusAt, 'live region must sit outside the swapped target').toBeLessThan(mainStart)
  })
})
