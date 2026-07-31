import { describe, it, expect, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { initViewToggle } from '../src/lib/viewToggle'

/**
 * Build a fixture matching the markup the site actually ships.
 *
 * The anchor deliberately carries NO aria-pressed and NO role: those
 * are invalid on a link and are applied by initViewToggle at runtime.
 * Keeping the fixture honest is what makes the init-time semantics
 * tests below meaningful.
 */
function makeDoc(): Document {
  const dom = new JSDOM(`
    <nav class="site-nav"><a href="#about">about</a></nav>
    <p data-view-status role="status" class="visually-hidden"></p>
    <div data-view-target><p id="human">human content</p><h2 id="about">About</h2></div>
  `)
  // Inserted separately so the anchor's attribute set is exactly what
  // the test asserts on, with no fixture-only extras.
  const toggle = dom.window.document.createElement('a')
  toggle.setAttribute('data-view-toggle', '')
  toggle.setAttribute('href', '/index.md')
  toggle.textContent = 'agent view'
  dom.window.document.body.prepend(toggle)
  return dom.window.document
}

describe('initViewToggle', () => {
  it('swaps in the markdown twin and marks the control pressed', async () => {
    const doc = makeDoc()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '# Allston Fojas\n\nCurrently: at Apple',
    }) as unknown as typeof fetch

    initViewToggle(doc, fetchImpl)
    const toggle = doc.querySelector('[data-view-toggle]') as HTMLAnchorElement
    toggle.dispatchEvent(new doc.defaultView!.Event('click', { cancelable: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))

    const target = doc.querySelector('[data-view-target]')!
    expect(target.querySelector('pre')).not.toBeNull()
    expect(target.textContent).toContain('Currently: at Apple')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(fetchImpl).toHaveBeenCalledWith('/index.md', expect.anything())
  })

  it('restores the human view on a second activation', async () => {
    const doc = makeDoc()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '# md',
    }) as unknown as typeof fetch

    initViewToggle(doc, fetchImpl)
    const toggle = doc.querySelector('[data-view-toggle]') as HTMLAnchorElement
    const Event_ = doc.defaultView!.Event

    toggle.dispatchEvent(new Event_('click', { cancelable: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    toggle.dispatchEvent(new Event_('click', { cancelable: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))

    const target = doc.querySelector('[data-view-target]')!
    expect(target.querySelector('#human')).not.toBeNull()
    expect(target.querySelector('pre')).toBeNull()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    // The markdown is fetched once and cached, not refetched on every toggle.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('falls back to plain navigation when the fetch fails', async () => {
    const doc = makeDoc()
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch

    initViewToggle(doc, fetchImpl)
    const toggle = doc.querySelector('[data-view-toggle]') as HTMLAnchorElement
    const evt = new doc.defaultView!.Event('click', { cancelable: true, bubbles: true })
    toggle.dispatchEvent(evt)
    await new Promise((r) => setTimeout(r, 0))

    // Human view is untouched and the control is not left stuck in a pressed state.
    expect(doc.querySelector('[data-view-target] #human')).not.toBeNull()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('applies button semantics at init, not in the shipped markup', () => {
    // C1: aria-pressed on an <a href> is an axe aria-allowed-attr
    // violation (impact critical) because it is not allowed on the
    // implicit role=link. Applying role=button + aria-pressed here, at
    // init, means the attributes only ever exist when JS is running -
    // which is exactly when the control really does behave as a button.
    const doc = makeDoc()
    const toggle = doc.querySelector('[data-view-toggle]') as HTMLAnchorElement

    expect(toggle.hasAttribute('role')).toBe(false)
    expect(toggle.hasAttribute('aria-pressed')).toBe(false)

    initViewToggle(doc, vi.fn() as unknown as typeof fetch)

    expect(toggle.getAttribute('role')).toBe('button')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('activates on a Space keydown, matching the button semantics it claims', () => {
    // A screen reader announces "toggle button, not pressed" once
    // role=button is applied. Space does not activate a link, so
    // without this handler the user is told to press Space and gets
    // nothing back.
    const doc = makeDoc()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '# md',
    }) as unknown as typeof fetch

    initViewToggle(doc, fetchImpl)
    const toggle = doc.querySelector('[data-view-toggle]') as HTMLAnchorElement
    const evt = new doc.defaultView!.KeyboardEvent('keydown', {
      key: ' ',
      cancelable: true,
      bubbles: true,
    })
    toggle.dispatchEvent(evt)

    expect(evt.defaultPrevented, 'Space must not also scroll the page').toBe(true)
    expect(fetchImpl).toHaveBeenCalled()
  })

  it('announces each view swap in the live region', () => {
    // The swap replaces every child of <main>. Without an announcement
    // it is a silent DOM replacement for a screen-reader user.
    const doc = makeDoc()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '# md',
    }) as unknown as typeof fetch

    initViewToggle(doc, fetchImpl)
    const status = doc.querySelector('[data-view-status]')!
    const toggle = doc.querySelector('[data-view-toggle]') as HTMLAnchorElement
    const Event_ = doc.defaultView!.Event

    expect(status.textContent).toBe('')

    toggle.dispatchEvent(new Event_('click', { cancelable: true, bubbles: true }))
    return new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => {
      const afterMarkdown = status.textContent ?? ''
      expect(afterMarkdown).not.toBe('')

      toggle.dispatchEvent(new Event_('click', { cancelable: true, bubbles: true }))
      const afterHuman = status.textContent ?? ''
      expect(afterHuman).not.toBe('')
      expect(afterHuman).not.toBe(afterMarkdown)
    })
  })

  it('lets a modified click perform its native action instead of swapping', async () => {
    // C2: preventDefault() ran unconditionally, so a cmd-click aimed at
    // opening the twin in a background tab was swallowed: no new tab,
    // and the page the reader was on got replaced underneath them.
    // Measured before the fix with {metaKey: true, button: 0}:
    // defaultPrevented true, fetch fired, view swapped.
    const doc = makeDoc()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '# md',
    }) as unknown as typeof fetch

    initViewToggle(doc, fetchImpl)
    const toggle = doc.querySelector('[data-view-toggle]') as HTMLAnchorElement
    const evt = new doc.defaultView!.MouseEvent('click', {
      metaKey: true,
      button: 0,
      cancelable: true,
      bubbles: true,
    })
    toggle.dispatchEvent(evt)
    await new Promise((r) => setTimeout(r, 0))

    expect(evt.defaultPrevented, 'the browser must be left to open the twin').toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(doc.querySelector('[data-view-target] #human')).not.toBeNull()
    expect(doc.querySelector('[data-view-target] pre')).toBeNull()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('still handles a plain primary click', async () => {
    // Guards the modified-click early return from being written so
    // broadly that it swallows the normal case too.
    const doc = makeDoc()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '# md',
    }) as unknown as typeof fetch

    initViewToggle(doc, fetchImpl)
    const toggle = doc.querySelector('[data-view-toggle]') as HTMLAnchorElement
    const evt = new doc.defaultView!.MouseEvent('click', {
      button: 0,
      cancelable: true,
      bubbles: true,
    })
    toggle.dispatchEvent(evt)
    await new Promise((r) => setTimeout(r, 0))

    expect(evt.defaultPrevented).toBe(true)
    expect(doc.querySelector('[data-view-target] pre')).not.toBeNull()
  })

  it('is inert when the expected elements are absent', () => {
    const dom = new JSDOM('<main></main>')
    expect(() => initViewToggle(dom.window.document)).not.toThrow()
  })

  it('renders markdown as text, never as HTML', async () => {
    // The markdown twin is same-origin and build-generated, but the agent
    // view must still be inert text: an injected tag has to appear as
    // literal characters, never as a live node.
    const doc = makeDoc()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '# Title\n\n<img src=x onerror="alert(1)">',
    }) as unknown as typeof fetch

    initViewToggle(doc, fetchImpl)
    const toggle = doc.querySelector('[data-view-toggle]') as HTMLAnchorElement
    toggle.dispatchEvent(new doc.defaultView!.Event('click', { cancelable: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))

    const target = doc.querySelector('[data-view-target]')!
    expect(target.querySelector('img')).toBeNull()
    expect(target.textContent).toContain('<img src=x')
  })

  it('does not let a stale, slower duplicate request revert an already-applied markdown view', async () => {
    // Reproduces the review-confirmed race: two activations fire before
    // the first fetch resolves, so with no re-entrancy guard both take
    // the fetch branch. The FIRST call resolves quickly and
    // successfully; the SECOND (duplicate, superseded) call resolves
    // LATER and rejects. Without a guard, that late rejection's catch
    // unconditionally calls showHuman() and silently reverts the
    // already-rendered markdown view with no user action and no error
    // shown. A correct implementation must not let a late-arriving
    // failure from a superseded request mutate view state.
    const doc = makeDoc()
    let callCount = 0
    const fetchImpl = vi.fn().mockImplementation(() => {
      callCount += 1
      if (callCount === 1) {
        // Fast, successful first request.
        return Promise.resolve({
          ok: true,
          text: async () => '# first, wins',
        })
      }
      // Slower, failing duplicate request - resolves after the first.
      return new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('stale duplicate failure')), 10)
      })
    }) as unknown as typeof fetch

    initViewToggle(doc, fetchImpl)
    const toggle = doc.querySelector('[data-view-toggle]') as HTMLAnchorElement
    const Event_ = doc.defaultView!.Event

    // Two activations dispatched back-to-back, before the first fetch
    // has had a chance to resolve.
    toggle.dispatchEvent(new Event_('click', { cancelable: true, bubbles: true }))
    toggle.dispatchEvent(new Event_('click', { cancelable: true, bubbles: true }))

    // Let the first (fast) fetch resolve and render.
    await new Promise((r) => setTimeout(r, 0))
    const target = doc.querySelector('[data-view-target]')!
    expect(target.querySelector('pre')).not.toBeNull()
    expect(toggle.getAttribute('aria-pressed')).toBe('true')

    // Let the second (slow, failing) request resolve too.
    await new Promise((r) => setTimeout(r, 20))

    // The markdown view must still be showing: a late failure from the
    // superseded duplicate request must not revert already-applied state.
    expect(target.querySelector('pre')).not.toBeNull()
    expect(target.textContent).toContain('first, wins')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })
})
