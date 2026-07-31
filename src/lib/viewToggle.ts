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

// Upper bound on a single markdown fetch. Without one, a request that
// never settles leaves the in-flight guard latched forever and the
// control is permanently, silently dead: every later click is dropped
// by the re-entrancy guard with no spinner and no error. A captive
// portal or a stalled connection produces exactly that. Long enough
// not to cut off a slow-but-working connection, short enough that a
// reader is not left clicking a dead control.
const DEFAULT_FETCH_TIMEOUT_MS = 8000

/**
 * Attach toggle behavior to the first matching control/target pair.
 *
 * No-ops silently when either element is absent, so importing this on a
 * page that does not carry the markup cannot throw.
 *
 * @param doc       Document to operate on (injected for jsdom testing).
 * @param fetchImpl Fetch implementation (injected for testing).
 * @param options   `timeoutMs` caps how long a markdown fetch may stay
 *                  outstanding before it is aborted. Injectable so the
 *                  hung-fetch recovery can be tested without waiting
 *                  the real timeout.
 */
export function initViewToggle(
  doc: Document,
  fetchImpl?: typeof fetch,
  options: { timeoutMs?: number } = {},
): void {
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

  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS

  /** Announce a view change to assistive tech via the status region. */
  const announce = (message: string): void => {
    if (status) status.textContent = message
  }

  /** Clear any error styling left over from a previous failed attempt. */
  const clearError = (): void => {
    toggle.classList.remove('is-error')
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
    // A fresh attempt clears the previous one's error styling, so the
    // control cannot stay visibly broken after it starts working.
    clearError()

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
    // Acknowledge the click while the request is outstanding. Without
    // this the control looks inert for the whole fetch, which on a slow
    // connection is indistinguishable from a broken button.
    toggle.classList.add('is-pending')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    void (async () => {
      try {
        const response = await doFetch(toggle.getAttribute('href') ?? '/index.md', {
          headers: { Accept: 'text/markdown, text/plain' },
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        markdown = await response.text()
        showMarkdown(markdown)
      } catch {
        // Every failure mode lands here: a rejected request, an aborted
        // one, and a response that arrived carrying a failing status.
        // All three used to be silent, which read as a dead button.
        toggle.classList.add('is-error')
        announce('The markdown view could not be loaded. The human page is still shown.')

        // Only revert if we actually swapped. On a first-activation
        // failure nothing was ever replaced, so calling showHuman()
        // here would detach and re-attach every child of <main> for no
        // reason, churning the React islands on an error path.
        if (showingMarkdown) showHuman()

        // The anchor still points at the real twin, so a modified
        // click remains a working escape hatch.
      } finally {
        clearTimeout(timer)
        toggle.classList.remove('is-pending')
        // Released on every path, including the aborted one. This is
        // what keeps a hung request from latching the control dead.
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

  // Every in-page target (#about, #projects, #experience, #loop) lives
  // INSIDE the swapped region, so with markdown showing none of them
  // exist while the sticky nav stays visible and clickable. Clicking
  // "experience" set the hash and did nothing.
  //
  // A click listener rather than a hashchange listener, for two
  // reasons. First, click runs synchronously BEFORE the browser
  // performs the default hash navigation, so restoring the human view
  // here guarantees the element exists by the time the browser looks
  // for it; hashchange fires after that lookup has already failed, and
  // the browser does not retry the scroll. Second, hashchange does not
  // fire at all when the new hash equals the current one, so a reader
  // who clicked "about", toggled to markdown, then clicked "about"
  // again would stay stuck.
  //
  // Delegated on the document so it covers the skip link and the
  // footer profile links too, not just the header nav.
  doc.addEventListener('click', (event: Event) => {
    if (!showingMarkdown) return

    const mouse = event as MouseEvent
    if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return
    if (typeof mouse.button === 'number' && mouse.button !== 0) return

    const el = event.target as Element | null
    const link = el?.closest?.('a[href^="#"]')
    if (!link || link === toggle) return

    // Restore synchronously and let the default action proceed, so the
    // browser's own hash scroll does the scrolling.
    showHuman()
  })
}
