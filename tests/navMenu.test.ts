// tests/navMenu.test.ts - the header hamburger menu.
//
// The menu exists because the header's section links leave at 960px (an
// SC 1.4.10 Reflow fix) and, until 2026-07-31, were replaced by nothing:
// on any narrower viewport the header simply had no navigation. Allston
// hit this at 923px. These tests pin the behaviours that make a
// hamburger accessible rather than merely present.
//
// Builds its own JSDOM per test, matching viewToggle.test.ts - this repo
// runs vitest in the default node environment, so there is no ambient
// `document` and every DOM fixture is explicit.
import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { initNavMenu } from '../src/lib/navMenu'

function makeDoc(): Document {
  const dom = new JSDOM(`
    <button class="nav-hamburger" id="nav-toggle" type="button" aria-expanded="false"
            aria-controls="site-nav" aria-label="Toggle navigation menu"></button>
    <nav class="site-nav" id="site-nav"><a href="#about">About</a></nav>
  `)
  return dom.window.document
}

/** Dispatch a bubbling click the way a real pointer would. */
function click(doc: Document, el: Element): void {
  el.dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('initNavMenu', () => {
  it('opens and closes on click, tracking aria-expanded', () => {
    const doc = makeDoc()
    initNavMenu(doc)
    const toggle = doc.getElementById('nav-toggle')!
    const panel = doc.getElementById('site-nav')!

    click(doc, toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(panel.classList.contains('is-open')).toBe(true)

    click(doc, toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(panel.classList.contains('is-open')).toBe(false)
  })

  it('closes on Escape and returns focus to the toggle', () => {
    // Without the focus return a keyboard user is dropped at the top of
    // the document with no idea where they are.
    const doc = makeDoc()
    initNavMenu(doc)
    const toggle = doc.getElementById('nav-toggle')!

    click(doc, toggle)
    doc.dispatchEvent(
      new doc.defaultView!.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(doc.activeElement).toBe(toggle)
  })

  it('closes when a click lands outside both the toggle and the panel', () => {
    const doc = makeDoc()
    initNavMenu(doc)
    const toggle = doc.getElementById('nav-toggle')!

    click(doc, toggle)
    click(doc, doc.body)

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('stays open when the click lands INSIDE the panel but not on a link', () => {
    // Guards the stopPropagation/containment logic: an outside-click
    // handler that is too eager closes the menu on any interaction.
    const doc = makeDoc()
    initNavMenu(doc)
    const toggle = doc.getElementById('nav-toggle')!
    const panel = doc.getElementById('site-nav')!

    click(doc, toggle)
    click(doc, panel)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('closes after following an in-page link, so the panel cannot cover the target', () => {
    // The vault's prior art (03_Efforts/nz-aus-2026/map.html) does NOT
    // do this, and it is a real gap there: tapping a link jumps to the
    // section and then leaves the open panel sitting on top of it.
    const doc = makeDoc()
    initNavMenu(doc)
    const toggle = doc.getElementById('nav-toggle')!

    click(doc, toggle)
    click(doc, doc.querySelector('#site-nav a')!)

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('is idempotent - a second init does not cancel the first', () => {
    // Found by code review 2026-07-31 and reproduced: without a guard,
    // two inits attach two click listeners to the same button. Both
    // fire on one click, one opens and the other closes, so the toggle
    // becomes a PERMANENT no-op - visually present, clickable, does
    // nothing. index.astro calls init once today, so this is latent,
    // but it is one careless re-import or view-transition away and the
    // failure mode is silent.
    const doc = makeDoc()
    initNavMenu(doc)
    initNavMenu(doc)
    const toggle = doc.getElementById('nav-toggle')!

    click(doc, toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('moves focus to the target section on link activation, not back to the toggle', () => {
    // A UX review found focus was silently dropped to <body>: the native
    // fragment navigation runs AFTER this handler, and the target
    // sections carried no tabindex, so neither the toggle nor the
    // section ended up holding focus. Worse than the reported symptom.
    //
    // Escape and click-outside DO return focus to the toggle - those are
    // "you are still oriented at the header" cases. A link click is a
    // deliberate navigation and focus must follow it.
    const dom = new JSDOM(`
      <button class="nav-hamburger" id="nav-toggle" type="button" aria-expanded="false"
              aria-controls="site-nav" aria-label="Toggle navigation menu"></button>
      <nav class="site-nav" id="site-nav"><a href="#about">About</a></nav>
      <section id="about" tabindex="-1"></section>
    `)
    const doc = dom.window.document
    initNavMenu(doc)
    const toggle = doc.getElementById('nav-toggle')!

    click(doc, toggle)
    click(doc, doc.querySelector('#site-nav a')!)

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(doc.activeElement).toBe(doc.getElementById('about'))
  })

  it('no-ops when the markup is absent', () => {
    // The module is imported unconditionally by index.astro; a page
    // without the markup must not throw and take the view toggle with it.
    const doc = new JSDOM('<div></div>').window.document
    expect(() => initNavMenu(doc)).not.toThrow()
  })
})
