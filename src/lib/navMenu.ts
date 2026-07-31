// src/lib/navMenu.ts - the header navigation menu toggle.
//
// The header's section links leave at 960px, which is a deliberate SC
// 1.4.10 Reflow fix (the full row measures ~892px). Until 2026-07-31
// they were replaced by nothing, so every viewport under 960px had a
// header with no navigation at all. This module is the replacement.
//
// Ported from 03_Efforts/nz-aus-2026/map.html - the vault's prior art
// for this pattern - with one addition it lacks: closing after an
// in-page link click. Without that, tapping "Projects" on a narrow
// screen jumps to the section and then covers it with the open panel.
//
// Progressive enhancement, same contract as viewToggle.ts: the markup
// ships as a real <button type="button"> and a real <nav> of real <a>
// elements. With JS off the links stay in the DOM and stay reachable
// through the footer nav, so nothing here is load-bearing for access to
// content - it only improves reach.
export function initNavMenu(doc: Document): void {
  const toggle = doc.getElementById('nav-toggle')
  const panel = doc.getElementById('site-nav')
  // Imported unconditionally by index.astro, so a page without this
  // markup must return quietly rather than throw and take the view
  // toggle down with it.
  if (!toggle || !panel) return

  // Idempotency guard. Without it a second init attaches a second set
  // of listeners: both fire on one click, one opens and the other
  // closes, and the toggle becomes a PERMANENT no-op - visibly present,
  // clickable, doing nothing. Found by code review 2026-07-31 and
  // reproduced before fixing. index.astro calls this once today, so the
  // bug was latent, but the failure is silent and an Astro view
  // transition or a stray re-import would surface it.
  if (toggle.dataset.navMenuInit === 'true') return
  toggle.dataset.navMenuInit = 'true'

  const isOpen = (): boolean => toggle.getAttribute('aria-expanded') === 'true'

  const open = (): void => {
    panel.classList.add('is-open')
    toggle.setAttribute('aria-expanded', 'true')
  }

  // `focusTarget` lets a link activation send focus to the section the
  // reader actually asked for. The other three close paths pass nothing
  // and fall back to the toggle, which is right for them: click-again,
  // Escape and click-outside all leave the reader oriented at the
  // header. preventScroll matters - without it, focusing the section
  // fights the browser's own fragment scroll and can overshoot the
  // scroll-margin-top offset that keeps the fixed header clear.
  const close = (focusTarget?: HTMLElement | null): void => {
    panel.classList.remove('is-open')
    toggle.setAttribute('aria-expanded', 'false')
    ;(focusTarget ?? toggle).focus({ preventScroll: true })
  }

  toggle.addEventListener('click', (event) => {
    // Stops this click reaching the document listener below, which
    // would otherwise read it as an outside-click and immediately
    // close what was just opened.
    event.stopPropagation()
    isOpen() ? close() : open()
  })

  doc.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape' && isOpen()) close()
  })

  doc.addEventListener('click', (event) => {
    const target = event.target as Node | null
    if (!target) return
    if (isOpen() && !panel.contains(target) && !toggle.contains(target)) close()
  })

  // Close on navigating to a section, sending focus to that section.
  // Without this the native fragment navigation drops focus on <body>:
  // it runs after this handler, and the sections are only focusable at
  // all because of the tabindex="-1" added in index.astro.
  // Bound on the panel rather than each link so links added later are
  // covered for free.
  panel.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement).closest('a')
    if (!link) return
    const href = link.getAttribute('href') ?? ''
    const target = href.startsWith('#') ? doc.querySelector<HTMLElement>(href) : null
    close(target)
  })
}
