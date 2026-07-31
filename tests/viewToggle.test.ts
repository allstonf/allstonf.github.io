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

  it('recovers from a hung fetch and stays usable afterwards', async () => {
    // I1: fetchInFlight never cleared if the fetch never settled, which
    // bricked the control permanently and silently. Measured before the
    // fix over 5 clicks: 1 fetch call, aria-pressed stayed false, label
    // unchanged, nothing applied, no spinner, no error. On a captive
    // portal that is a reader clicking forever at a dead button.
    //
    // The mock honors the abort signal, which is what a real fetch
    // does; that is the mechanism the fix relies on to recover.
    const doc = makeDoc()
    let callCount = 0
    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      callCount += 1
      if (callCount === 1) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      }
      return Promise.resolve({ ok: true, text: async () => '# recovered' })
    }) as unknown as typeof fetch

    initViewToggle(doc, fetchImpl, { timeoutMs: 10 })
    const toggle = doc.querySelector('[data-view-toggle]') as HTMLAnchorElement
    const Event_ = doc.defaultView!.Event

    toggle.dispatchEvent(new Event_('click', { cancelable: true, bubbles: true }))
    // While outstanding, the click is acknowledged visually rather than
    // looking like nothing happened.
    expect(toggle.classList.contains('is-pending')).toBe(true)

    await new Promise((r) => setTimeout(r, 40))

    // Recovered: no longer stuck pending, and the failure is visible.
    expect(toggle.classList.contains('is-pending')).toBe(false)

    // And a later activation can still succeed.
    toggle.dispatchEvent(new Event_('click', { cancelable: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(doc.querySelector('[data-view-target] pre')?.textContent).toContain('recovered')
  })

  it('gives a visible signal when the twin responds not-ok', async () => {
    // I2: the !response.ok branch reset the control to its resting
    // state with no DOM signal, indistinguishable from a dead button.
    // Distinct from the reject-path test above: this is a response that
    // arrives successfully and carries a failing status.
    const doc = makeDoc()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found',
    }) as unknown as typeof fetch

    initViewToggle(doc, fetchImpl)
    const toggle = doc.querySelector('[data-view-toggle]') as HTMLAnchorElement
    toggle.dispatchEvent(new doc.defaultView!.Event('click', { cancelable: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))

    expect(toggle.classList.contains('is-error')).toBe(true)
    expect(doc.querySelector('[data-view-status]')!.textContent).toMatch(/could not|unavailable/i)
    // Still resting, and still a working link to the twin.
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(doc.querySelector('[data-view-target] #human')).not.toBeNull()
  })

  it('does not churn the human view when a first activation fails', async () => {
    // Minor 1: the catch called showHuman() even on a FIRST-click
    // failure, when nothing had been swapped. Measured: 2 nodes removed
    // and 2 re-added, needless React-island churn on an error path.
    const doc = makeDoc()
    const target = doc.querySelector('[data-view-target]') as HTMLElement
    const replaceSpy = vi.spyOn(target, 'replaceChildren')
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch

    initViewToggle(doc, fetchImpl)
    const toggle = doc.querySelector('[data-view-toggle]') as HTMLAnchorElement
    toggle.dispatchEvent(new doc.defaultView!.Event('click', { cancelable: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))

    expect(replaceSpy, 'nothing was swapped, so nothing needs reverting').not.toHaveBeenCalled()
    expect(doc.querySelector('[data-view-target] #human')).not.toBeNull()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('restores the human view when an in-page nav link is activated', async () => {
    // I3: every in-page target (#about, #experience, #projects)
    // lives inside [data-view-target], so with markdown showing they do
    // not exist. Measured: document.getElementById('about') === null
    // while the sticky nav stayed visible and clickable. Clicking
    // "experience" set the URL hash and nothing happened.
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
    expect(doc.getElementById('about'), 'precondition: target is gone').toBeNull()

    const navLink = doc.querySelector('.site-nav a[href="#about"]') as HTMLAnchorElement
    navLink.dispatchEvent(
      new doc.defaultView!.MouseEvent('click', { button: 0, cancelable: true, bubbles: true }),
    )

    // Synchronously restored, so the browser's default hash scroll
    // finds a real element. Not awaited on purpose: an async restore
    // would land after the browser had already given up on the hash.
    expect(doc.getElementById('about'), 'nav target must exist again').not.toBeNull()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('leaves in-page nav alone when the human view is already showing', () => {
    // The listener must not replace the DOM on every nav click; that
    // would churn the islands on ordinary navigation.
    const doc = makeDoc()
    const target = doc.querySelector('[data-view-target]') as HTMLElement
    initViewToggle(doc, vi.fn() as unknown as typeof fetch)
    const replaceSpy = vi.spyOn(target, 'replaceChildren')

    const navLink = doc.querySelector('.site-nav a[href="#about"]') as HTMLAnchorElement
    navLink.dispatchEvent(
      new doc.defaultView!.MouseEvent('click', { button: 0, cancelable: true, bubbles: true }),
    )

    expect(replaceSpy).not.toHaveBeenCalled()
  })

  it('manages scroll position across the swap instead of stranding the reader', async () => {
    // Minor 2: toggling at 2,500px dropped the reader deep inside a
    // long <pre>, mid-content, with the "[ markdown source ]" label off
    // screen. Entering markdown scrolls the new view into view;
    // returning restores where the reader was in the human page.
    const doc = makeDoc()
    const view = doc.defaultView!
    const calls: number[] = []
    // jsdom does not implement scrolling, so record the intent.
    view.scrollTo = ((arg: { top: number }) => calls.push(arg.top)) as typeof view.scrollTo
    Object.defineProperty(view, 'scrollY', { value: 2500, writable: true, configurable: true })

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '# md',
    }) as unknown as typeof fetch

    initViewToggle(doc, fetchImpl)
    const toggle = doc.querySelector('[data-view-toggle]') as HTMLAnchorElement
    const Event_ = doc.defaultView!.Event

    toggle.dispatchEvent(new Event_('click', { cancelable: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))

    // Entering markdown must not leave the reader at 2500px.
    expect(calls.length).toBe(1)
    expect(calls[0]).toBeLessThan(2500)

    toggle.dispatchEvent(new Event_('click', { cancelable: true, bubbles: true }))
    // Returning puts the reader back where they were reading.
    expect(calls.length).toBe(2)
    expect(calls[1]).toBe(2500)
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
