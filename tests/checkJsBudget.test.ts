// tests/checkJsBudget.test.ts - scripts/check-js-budget.mjs, the CI gate
// on total gzipped JS a browser actually downloads.
//
// The load-bearing risk here (found by hand against this exact repo's
// build, before this checker existed): Astro hydrates an island via a
// custom element, not a <script src> tag -
//   <astro-island component-url="..." renderer-url="..." ...>
// A checker that only looks for <script src> and <link
// rel="modulepreload"> finds ZERO reachable JS on this site and
// reports a passing budget forever, even though a browser downloads
// ~60 KB gzipped the moment the island hydrates. That failure mode is
// worse than no gate at all, because it looks green.
//
// This file tests three layers: (1) reference extraction on a small
// fixture HTML string, so the astro-island / script-src / modulepreload
// parsing is verified independent of any real build; (2) the
// silent-zero guard in isolation, including a literal recreation of
// the OLD buggy (script-src-only) extractor to prove the guard catches
// exactly the failure mode described above; (3) an integration test
// against the real `dist/` produced by `astro build`, following the
// same "tests read dist/ directly" convention tests/parity.test.ts
// already uses - so `npx astro build` must run before this test file,
// exactly as the CI workflow orders it.

import { existsSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  assertNotSilentZero,
  computeBudgetReport,
  DEFAULT_BUDGET_BYTES,
  extractInlineExecutableScripts,
  extractReferences,
  hasAstroIsland,
  SilentZeroBudgetError,
} from '../scripts/check-js-budget.mjs'

// A fixture shaped like real Astro output: one astro-island (the ONLY
// reference form that matters for this site's hydration), zero
// <script src> tags (index.astro's inline scripts have no src attr,
// matching the real dist/index.html), and one modulepreload link for
// good measure so that extraction path is exercised too.
const FIXTURE_HTML_WITH_ISLAND = `<!doctype html>
<html>
<head>
<link rel="modulepreload" href="/_astro/preloaded.abc123.js" />
</head>
<body>
<astro-island uid="x1" component-url="/_astro/Widget.def456.js" component-export="default" renderer-url="/_astro/client.ghi789.js" props="{}" ssr client="visible" opts="{}" await-children></astro-island>
<script>console.log('inline, no src - never a reference')</script>
</body>
</html>`

const FIXTURE_HTML_NO_ISLAND = `<!doctype html>
<html><body><p>static shell, no islands at all</p></body></html>`

// A fixture with four script shapes that must be told apart:
//   - an inline module script with a real body (must be counted - JS)
//   - a module script that points at an external file via src (must NOT
//     be counted here - it is already covered by
//     extractReferences/buildReachableSet, and its inline body is empty
//     anyway since the src attribute is what a browser actually fetches)
//   - a classic inline script with no type attribute at all (must be
//     counted - the HTML default script type IS JavaScript, and this is
//     exactly the shape of Astro's island bootstrap / hydration runtime)
//   - a JSON-LD data block (must NOT be counted - it is data, not a
//     program a browser executes)
const FIXTURE_HTML_WITH_INLINE_SCRIPTS = `<!doctype html>
<html>
<body>
<script type="module">const viewToggle = () => { console.log('inline module body') }</script>
<script type="module" src="/_astro/external.abc123.js"></script>
<script>console.log('classic inline script, no type attribute, real executable JS')</script>
<script type="application/ld+json">{"@context": "https://schema.org", "@type": "Person"}</script>
</body>
</html>`

describe('extractReferences finds all four Astro reference forms', () => {
  it('extracts astro-island component-url and renderer-url', () => {
    const refs = extractReferences(FIXTURE_HTML_WITH_ISLAND)
    expect(refs).toContain('/_astro/Widget.def456.js')
    expect(refs).toContain('/_astro/client.ghi789.js')
  })

  it('extracts a modulepreload link href', () => {
    const refs = extractReferences(FIXTURE_HTML_WITH_ISLAND)
    expect(refs).toContain('/_astro/preloaded.abc123.js')
  })

  it('does not fabricate a reference from an inline <script> with no src', () => {
    const refs = extractReferences(FIXTURE_HTML_WITH_ISLAND)
    expect(refs.some((ref) => ref.includes('console.log'))).toBe(false)
  })

  it('extracts a <script type="module" src="..."> reference', () => {
    const html = `<script type="module" src="/_astro/entry.xyz.js"></script>`
    expect(extractReferences(html)).toContain('/_astro/entry.xyz.js')
  })
})

describe('extractInlineExecutableScripts finds every inline script a browser executes as JS', () => {
  it('extracts the body text of an inline module script with no src', () => {
    const scripts = extractInlineExecutableScripts(FIXTURE_HTML_WITH_INLINE_SCRIPTS)
    expect(scripts).toContain("const viewToggle = () => { console.log('inline module body') }")
  })

  it('does not extract a module script that has a src attribute (already an external reference)', () => {
    const scripts = extractInlineExecutableScripts(FIXTURE_HTML_WITH_INLINE_SCRIPTS)
    expect(scripts.some((src) => src.includes('external.abc123'))).toBe(false)
  })

  // This is the new failing-test-first case: a classic inline script with
  // no type attribute at all is real executable JS (the HTML default
  // script type IS JavaScript) - it must now be COUNTED, reversing the
  // previous (too narrow) module-only behavior.
  it('extracts a classic inline script with no type attribute (real executable JS)', () => {
    const scripts = extractInlineExecutableScripts(FIXTURE_HTML_WITH_INLINE_SCRIPTS)
    expect(scripts.some((src) => src.includes('classic inline script'))).toBe(true)
  })

  // This is the other new failing-test-first case: a JSON-LD block is
  // structured data, not a program - it must never be counted as JS even
  // though it lives inside a <script> tag.
  it('does not extract a type="application/ld+json" data block', () => {
    const scripts = extractInlineExecutableScripts(FIXTURE_HTML_WITH_INLINE_SCRIPTS)
    expect(scripts.some((src) => src.includes('@context'))).toBe(false)
  })

  it('returns an empty array for HTML with no inline scripts at all', () => {
    expect(extractInlineExecutableScripts(FIXTURE_HTML_NO_ISLAND)).toEqual([])
  })
})

describe('hasAstroIsland detects the presence of the custom element', () => {
  it('is true for a page that mounts an island', () => {
    expect(hasAstroIsland(FIXTURE_HTML_WITH_ISLAND)).toBe(true)
  })

  it('is false for a page with no islands at all', () => {
    expect(hasAstroIsland(FIXTURE_HTML_NO_ISLAND)).toBe(false)
  })
})

describe('assertNotSilentZero catches the silent-zero failure mode', () => {
  // This is the failing-test-first case the plan calls for: recreate
  // the OLD buggy extractor (script-src-only, the naive version this
  // checker replaced) verbatim, run it against a fixture that DOES
  // have a real island, and prove it finds nothing - then prove the
  // guard rejects that exact zero.
  function naiveScriptSrcOnlyExtractor(html: string): string[] {
    const refs: string[] = []
    for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) refs.push(match[1])
    return refs
  }

  it('the naive script-src-only extractor finds zero refs on a real island page', () => {
    // Documents the bug this checker exists to prevent: the fixture
    // has a real <astro-island>, but the naive extractor never looks
    // at astro-island attributes at all.
    expect(naiveScriptSrcOnlyExtractor(FIXTURE_HTML_WITH_ISLAND)).toEqual([])
  })

  it('throws when an island is present but the reachable byte total is zero', () => {
    expect(() => assertNotSilentZero(true, 0)).toThrow(SilentZeroBudgetError)
  })

  it('does not throw when there is no island and the total is legitimately zero', () => {
    expect(() => assertNotSilentZero(false, 0)).not.toThrow()
  })

  it('does not throw when an island is present and the reachable total is nonzero', () => {
    expect(() => assertNotSilentZero(true, 60536)).not.toThrow()
  })
})

describe('computeBudgetReport against the real dist/ build', () => {
  // Same convention as tests/parity.test.ts: this test reads dist/
  // directly, so `npx astro build` must have already run. The CI
  // workflow (and every local run in this repo since Task 1) always
  // builds before testing.
  const distDir = 'dist'

  it('dist/ exists (astro build ran before this test file)', () => {
    expect(existsSync(`${distDir}/index.html`)).toBe(true)
  })

  it('passes at the real 150 KB budget', () => {
    const report = computeBudgetReport({ distDir, budgetBytes: DEFAULT_BUDGET_BYTES })
    expect(report.passed).toBe(true)
    // Was toBeGreaterThan(0) until 2026-07-31, when the Loop section -
    // the page's only React island - was removed. With no island there
    // is no external reachable JS at all, so ZERO is now the correct
    // and expected value, not a broken extractor. Pinned exactly rather
    // than loosened to >= 0, so re-introducing an island (or an
    // accidental script import) fails here and gets a deliberate look.
    expect(report.reachableBytes).toBe(0)
    expect(report.reachableBytes).toBeLessThan(DEFAULT_BUDGET_BYTES)
  })

  it('fails on a deliberately lowered budget - this is the overage test the plan asks for', () => {
    const report = computeBudgetReport({ distDir, budgetBytes: 1 })
    expect(report.passed).toBe(false)
  })

  it('does not throw the silent-zero guard against the real (working) extractor', () => {
    // Inverted 2026-07-31. The real page NO LONGER contains an
    // astro-island: removing the Loop section removed the only one.
    //
    // ⚠️ Consequence worth knowing: assertNotSilentZero() throws only
    // when (hasIsland && reachable === 0), so with no island the
    // silent-zero guard is DORMANT - it cannot fire on this page. That
    // is correct (there is nothing to extract, so a zero is honest),
    // but it means the extractor's find-an-island behaviour is covered
    // only by the synthetic fixtures above, not live-fire. If an island
    // is ever added back, this assertion flips and the live-fire proof
    // returns with it.
    const html = readFileSync(`${distDir}/index.html`, 'utf8')
    expect(hasAstroIsland(html)).toBe(false)
    expect(() => computeBudgetReport({ distDir, budgetBytes: DEFAULT_BUDGET_BYTES })).not.toThrow(SilentZeroBudgetError)
  })

  it('every reachable file is also counted in total emitted bytes (reachable is a subset)', () => {
    const report = computeBudgetReport({ distDir, budgetBytes: DEFAULT_BUDGET_BYTES })
    expect(report.reachableBytes).toBeLessThanOrEqual(report.totalEmittedBytes)
  })

  it('lists no overlap between reachable and unreachable files', () => {
    const report = computeBudgetReport({ distDir, budgetBytes: DEFAULT_BUDGET_BYTES })
    const reachableNames = new Set(report.reachableFiles.map((f: { file: string }) => f.file))
    for (const entry of report.unreachableFiles) {
      expect(reachableNames.has(entry.file)).toBe(false)
    }
  })

  // This is the failing-test-first case for the SECOND round of this gate:
  // the real dist/index.html has both an inline module script AND two
  // classic inline scripts (Astro's intersection-observer bootstrap and
  // its hydration runtime) with no type attribute - all real executable
  // JS emitted directly into the HTML response. A JSON-LD data block is
  // also present and must be excluded. Computed independently here (via a
  // plain regex, not the function under test) so this test does not just
  // restate the implementation.
  it('the budgeted total includes gzipped bytes for every executable inline script, not only type="module" (RED before the fix)', () => {
    const html = readFileSync(`${distDir}/index.html`, 'utf8')
    const scriptTagRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
    const expectedBodies: string[] = []
    for (const match of html.matchAll(scriptTagRe)) {
      const openAttrs = match[1]
      const hasSrc = /\bsrc\s*=/i.test(openAttrs)
      const typeMatch = /\btype\s*=\s*"([^"]*)"/i.exec(openAttrs)
      const type = typeMatch ? typeMatch[1] : ''
      const isDataType = /json|importmap/i.test(type)
      if (!hasSrc && !isDataType) expectedBodies.push(match[2])
    }
    // The real build has 1 module script, excluding the JSON-LD data
    // block. Was 3 until 2026-07-31: the other two were Astro's classic
    // island-hydration scripts, emitted only because the page mounted a
    // React island. Removing the Loop section removed both. The point
    // of this test is unchanged - the budget must count inline bytes,
    // not only type="module" - and one module script still exercises it.
    expect(expectedBodies.length).toBeGreaterThanOrEqual(1)

    const inlineBytes = expectedBodies.reduce((sum, body) => sum + gzipSync(Buffer.from(body, 'utf8')).length, 0)

    const report = computeBudgetReport({ distDir, budgetBytes: DEFAULT_BUDGET_BYTES })
    const externalReachableBytes = report.reachableFiles.reduce((sum: number, f: { bytes: number }) => sum + f.bytes, 0)
    // reachableBytes must keep meaning "external file reachable set only"
    // (the task requires the existing external-file logic not be silently
    // redefined), so it should still equal the external sum exactly.
    expect(report.reachableBytes).toBe(externalReachableBytes)
    // The number actually gated against the budget must include ALL
    // executable inline script bytes on top of the external reachable set.
    expect(report.budgetedBytes).toBe(externalReachableBytes + inlineBytes)
    expect(report.inlineScriptBytes).toBe(inlineBytes)
  })

  it('still passes at the real 150 KB budget once all executable inline scripts are included', () => {
    const report = computeBudgetReport({ distDir, budgetBytes: DEFAULT_BUDGET_BYTES })
    expect(report.passed).toBe(report.budgetedBytes <= DEFAULT_BUDGET_BYTES)
    expect(report.passed).toBe(true)
  })

  it('emits no unreachable JavaScript chunk at all', () => {
    // The Loop section was the only React island. Once it and the
    // @astrojs/react integration are gone, Astro should emit no client
    // renderer - not merely an unreachable one. An "emitted but
    // UNREACHABLE" entry costs visitors nothing (no HTML references it)
    // but ships ~58 KB of dead artifact on every deploy, and its presence
    // means the React dependency chain is still wired up.
    //
    // NOTE: the plan that introduced this test named the helper
    // runBudgetCheck() and a report.unreachable field. Neither exists in
    // this file - the real helper is computeBudgetReport() (already
    // imported above) and the real field is report.unreachableFiles, per
    // the describe block this test lives in. Using the real names per
    // the plan's own instruction to read before writing.
    const report = computeBudgetReport({ distDir, budgetBytes: DEFAULT_BUDGET_BYTES })
    expect(report.unreachableFiles).toEqual([])
  })
})
