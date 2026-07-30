// src/lib/viewToggle.ts - the Human/Agent view toggle.
//
// The markdown twin of this page already exists at /index.md
// (src/pages/index.md.ts) and is already advertised to agents via
// <link rel="alternate" type="text/markdown"> in index.astro's head.
// This module adds only the VISIBLE affordance, so a human reader can
// see the machine surface the page exposes.
//
// Authored as a plain module rather than a React island on purpose:
// the JS budget is a binding CI gate (150 KB gzipped, currently ~62 KB)
// and this needs no state library. LoopExplainer is the one component
// that earns React.
//
// Progressive enhancement is the contract. The control ships as a real
// <a href="/index.md">, so with scripting disabled it still works. The
// script upgrades it into an in-page swap so the human never depends on
// how a given browser handles a text/markdown response - several
// download it rather than display it, which would be a broken-feeling
// toggle. Both views keep real, independently fetchable URLs, so both
// remain crawlable and citable.

const TOGGLE_SELECTOR = '[data-view-toggle]'
const TARGET_SELECTOR = '[data-view-target]'

/**
 * Attach toggle behavior to the first matching control/target pair.
 *
 * No-ops silently when either element is absent, so importing this on a
 * page that does not carry the markup cannot throw.
 *
 * @param doc       Document to operate on (injected for jsdom testing).
 * @param fetchImpl Fetch implementation (injected for testing).
 */
export function initViewToggle(doc: Document, fetchImpl?: typeof fetch): void {
  const toggle = doc.querySelector<HTMLAnchorElement>(TOGGLE_SELECTOR)
  const target = doc.querySelector<HTMLElement>(TARGET_SELECTOR)
  if (!toggle || !target) return

  const doFetch = fetchImpl ?? (doc.defaultView?.fetch?.bind(doc.defaultView) as typeof fetch)
  if (!doFetch) return

  // Captured once, synchronously, at init time. This is a snapshot, not
  // a live reference: if any future code appends a new top-level child
  // to the target (a lazily-injected banner, a late client-only widget)
  // AFTER this line runs, that node is absent from the snapshot and
  // gets silently dropped the first time a user toggles to markdown
  // and back to human.
  const humanNodes = Array.from(target.childNodes)
  let markdown: string | null = null
  let showingMarkdown = false
  // True while a markdown fetch is outstanding. Guards against the
  // re-entrancy race where a second activation fired before the first
  // fetch resolves starts a second, duplicate request; if that
  // duplicate resolves LATER than the first and fails, its catch would
  // otherwise revert an already-applied, successful markdown view with
  // no user action and no visible error. Only one fetch is ever allowed
  // in flight, so a superseded request can never exist to race.
  let fetchInFlight = false

  const showHuman = (): void => {
    target.replaceChildren(...humanNodes)
    toggle.setAttribute('aria-pressed', 'false')
    toggle.textContent = 'view as markdown'
    showingMarkdown = false
  }

  const showMarkdown = (source: string): void => {
    const pre = doc.createElement('pre')
    pre.className = 'agent-view'
    // textContent, never innerHTML: the agent view is inert text by
    // construction, so nothing in the markdown can become a live node.
    pre.textContent = source
    target.replaceChildren(pre)
    toggle.setAttribute('aria-pressed', 'true')
    toggle.textContent = 'view as human page'
    showingMarkdown = true
  }

  toggle.addEventListener('click', (event: Event) => {
    event.preventDefault()

    if (showingMarkdown) {
      showHuman()
      return
    }

    if (markdown !== null) {
      showMarkdown(markdown)
      return
    }

    // Re-entrancy guard: a click while a fetch is already outstanding
    // is a no-op rather than a second concurrent request. preventDefault
    // above has already run, so this just drops the redundant
    // activation; it does not fall through to a real navigation.
    if (fetchInFlight) return

    fetchInFlight = true
    void (async () => {
      try {
        const response = await doFetch(toggle.getAttribute('href') ?? '/index.md', {
          headers: { Accept: 'text/markdown, text/plain' },
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        markdown = await response.text()
        showMarkdown(markdown)
      } catch {
        // Leave the human view intact and the control unpressed. Note
        // that this does NOT enable "a second click navigates to the
        // markdown twin directly": preventDefault() above runs on every
        // click unconditionally, so a plain second click just
        // re-triggers this same fetch path and can fail the same way.
        // Only a modified click (middle-click, ctrl/cmd-click) bypasses
        // this handler and navigates for real. Failing back to a
        // stable, working human view beats failing into a
        // half-toggled state.
        showHuman()
      } finally {
        fetchInFlight = false
      }
    })()
  })
}
