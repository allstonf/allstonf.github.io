// src/lib/sectionOrder.ts - the ONE declaration of what order the page's
// body sections appear in.
//
// The human page (src/pages/index.astro) and the markdown twin
// (renderIndexMd in src/lib/agentSurface.ts) are two independent
// renderers over one content model. That independence is deliberate -
// ADR decision_2026-07-31_agent-surface-parallel-renderer-not-dom-
// conversion rejected converting the rendered DOM to markdown, because
// it breaks progressive enhancement and inherits page chrome. But
// independence meant nothing forced the two into the same order, and
// they drifted: the page ran About > Experience > Projects while
// index.md ran About > Projects > Experience.
//
// This constant is the coupling that replaces the rejected conversion.
// It is asserted by tests/parity.test.ts against BOTH built artifacts,
// so reordering one surface without the other fails the build.
export const SECTION_ORDER = ['About', 'Experience', 'Projects'] as const

export type SectionName = (typeof SECTION_ORDER)[number]
