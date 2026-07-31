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
const STATUS_SELECTOR = '[data-view-status]'

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

  const status = doc.querySelector<HTMLElement>(STATUS_SELECTOR)

  // Progressive enhancement of the SEMANTICS, not just the behavior.
  // The markup ships as a plain <a href="/index.md"> because
  // aria-pressed is not allowed on the implicit role=link of an anchor
  // (axe: aria-allowed-attr, impact critical). Applying role=button
  // and aria-pressed here means they exist only when this script runs,
  // which is exactly when the control genuinely behaves as a button.
  // A no-JS reader is left with a clean, valid link to the twin.
  toggle.setAttribute('role', 'button')
  toggle.setAttribute('aria-pressed', 'false')

  /** Announce a view change to assistive tech via the status region. */
  const announce = (message: string): void => {
    if (status) status.textContent = message
  }

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

  // The label never changes. State is carried by aria-pressed for
  // assistive tech and by the dot plus border for sighted readers,
  // which is also why the control needs no reserved width: with one
  // label there is only ever one box width.
  const showHuman = (): void => {
    target.replaceChildren(...humanNodes)
    toggle.setAttribute('aria-pressed', 'false')
    showingMarkdown = false
    announce('Human page restored.')
  }

  const showMarkdown = (source: string): void => {
    const pre = doc.createElement('pre')
    pre.className = 'agent-view'
    // textContent, never innerHTML: the agent view is inert text by
    // construction, so nothing in the markdown can become a live node.
    pre.textContent = source
    target.replaceChildren(pre)
    toggle.setAttribute('aria-pressed', 'true')
    showingMarkdown = true
    announce('Markdown source shown. This is the view AI agents receive.')
  }

  const activate = (): void => {
    if (showingMarkdown) {
      showHuman()
      return
    }

    if (markdown !== null) {
      showMarkdown(markdown)
      return
    }

    // Re-entrancy guard: an activation while a fetch is already
    // outstanding is a no-op rather than a second concurrent request.
    // The caller has already suppressed the default action, so this
    // drops the redundant activation without falling through to a
    // real navigation.
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
        // Leave the human view intact and the control unpressed.
        //
        // A plain second click does NOT navigate to the twin: it
        // re-enters this same fetch path and can fail the same way.
        // A modified click (cmd, ctrl, shift, alt) and any non-primary
        // button DO bypass this handler and navigate for real, because
        // the click listener returns before preventDefault for those.
        // Failing back to a stable, working human view beats failing
        // into a half-toggled state.
        showHuman()
      } finally {
        fetchInFlight = false
      }
    })()
  }

  toggle.addEventListener('click', (event: Event) => {
    // A modified click is the reader asking the BROWSER for something
    // this handler cannot give them: a background tab, a new window, a
    // download, a save. Returning before preventDefault lets the
    // browser perform its native action on the real href. Swallowing
    // it meant a cmd-click replaced the page being read instead of
    // opening the twin alongside it.
    const mouse = event as MouseEvent
    if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return
    // Anything other than the primary button (middle-click auxiliary
    // navigation, right-click context menu) is likewise the browser's
    // to handle.
    if (typeof mouse.button === 'number' && mouse.button !== 0) return

    event.preventDefault()
    activate()
  })

  // role=button makes a screen reader announce "toggle button", and a
  // button is expected to activate on Space. A link does not, so
  // without this the user is told to press Space and nothing happens.
  // Enter already activates an anchor natively and arrives as a click.
  toggle.addEventListener('keydown', (event: Event) => {
    const key = (event as KeyboardEvent).key
    if (key !== ' ' && key !== 'Spacebar') return
    // Space would otherwise scroll the page underneath the control.
    event.preventDefault()
    activate()
  })
}
