import { describe, it, expect, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { initViewToggle } from '../src/lib/viewToggle'

function makeDoc(): Document {
  const dom = new JSDOM(`
    <a data-view-toggle href="/index.md" aria-pressed="false">view as markdown</a>
    <div data-view-target><p id="human">human content</p></div>
  `)
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
