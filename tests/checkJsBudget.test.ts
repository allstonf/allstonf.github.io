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
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import {
  hasAstroIsland,
  extractReferences,
  extractInlineModuleScripts,
  assertNotSilentZero,
  SilentZeroBudgetError,
  computeBudgetReport,
  DEFAULT_BUDGET_BYTES,
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

// A fixture with three script shapes that must be told apart: an inline
// module script with a real body (must be counted), a module script that
// points at an external file via src (must NOT be double counted - its
// bytes are already covered by extractReferences/buildReachableSet), and a
// classic inline script with no type attribute at all (not a module, must
// be ignored by this extractor even though it is real executable JS).
const FIXTURE_HTML_WITH_INLINE_MODULE = `<!doctype html>
<html>
<body>
<script type="module">const viewToggle = () => { console.log('inline module body') }</script>
<script type="module" src="/_astro/external.abc123.js"></script>
<script>console.log('classic inline script, not a module, must be ignored')</script>
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

describe('extractInlineModuleScripts finds inline <script type="module"> bodies', () => {
  it('extracts the body text of an inline module script with no src', () => {
    const scripts = extractInlineModuleScripts(FIXTURE_HTML_WITH_INLINE_MODULE)
    expect(scripts).toContain("const viewToggle = () => { console.log('inline module body') }")
  })

  it('does not extract a module script that has a src attribute (already an external reference)', () => {
    const scripts = extractInlineModuleScripts(FIXTURE_HTML_WITH_INLINE_MODULE)
    expect(scripts.some((src) => src.includes('external.abc123'))).toBe(false)
  })

  it('does not extract a classic inline script with no type attribute', () => {
    const scripts = extractInlineModuleScripts(FIXTURE_HTML_WITH_INLINE_MODULE)
    expect(scripts.some((src) => src.includes('classic inline script'))).toBe(false)
  })

  it('returns an empty array for HTML with no inline module scripts', () => {
    expect(extractInlineModuleScripts(FIXTURE_HTML_NO_ISLAND)).toEqual([])
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
    const re = /<script\b[^>]*\bsrc=["']([^"']+)["']/gi
    let match: RegExpExecArray | null
    while ((match = re.exec(html))) refs.push(match[1])
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
    expect(report.reachableBytes).toBeGreaterThan(0)
    expect(report.reachableBytes).toBeLessThan(DEFAULT_BUDGET_BYTES)
  })

  it('fails on a deliberately lowered budget - this is the overage test the plan asks for', () => {
    const report = computeBudgetReport({ distDir, budgetBytes: 1 })
    expect(report.passed).toBe(false)
  })

  it('does not throw the silent-zero guard against the real (working) extractor', () => {
    // The real page DOES contain an astro-island (LoopExplainer), so
    // this is the live-fire proof that the real extractor - unlike the
    // naive one above - actually finds it.
    const html = readFileSync(`${distDir}/index.html`, 'utf8')
    expect(hasAstroIsland(html)).toBe(true)
    expect(() => computeBudgetReport({ distDir, budgetBytes: DEFAULT_BUDGET_BYTES })).not.toThrow(
      SilentZeroBudgetError,
    )
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

  // This is the failing-test-first case the task calls for. The real
  // dist/index.html has at least one inline <script type="module"> (the
  // view-toggle module) that is emitted directly into the HTML response
  // rather than as a separate file - so it is exactly the kind of JS the
  // module header claims to bound, but the OLD extractor never looked at
  // it. Computed independently here (via a plain regex, not the function
  // under test) so this test does not just restate the implementation.
  it('the budgeted total includes gzipped inline module-script bytes (RED before the fix)', () => {
    const html = readFileSync(`${distDir}/index.html`, 'utf8')
    const inlineModuleBodies = [
      ...html.matchAll(/<script\s+type="module"(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
    ].map((match) => match[1])
    expect(inlineModuleBodies.length).toBeGreaterThan(0)

    const inlineBytes = inlineModuleBodies.reduce(
      (sum, body) => sum + gzipSync(Buffer.from(body, 'utf8')).length,
      0,
    )

    const report = computeBudgetReport({ distDir, budgetBytes: DEFAULT_BUDGET_BYTES })
    const externalReachableBytes = report.reachableFiles.reduce(
      (sum: number, f: { bytes: number }) => sum + f.bytes,
      0,
    )
    // reachableBytes must keep meaning "external file reachable set only"
    // (the task requires the existing external-file logic not be silently
    // redefined), so it should still equal the external sum exactly.
    expect(report.reachableBytes).toBe(externalReachableBytes)
    // The number actually gated against the budget must include the inline
    // module bytes on top of the external reachable set.
    expect(report.budgetedBytes).toBe(externalReachableBytes + inlineBytes)
    expect(report.inlineModuleBytes).toBe(inlineBytes)
  })

  it('still passes at the real 150 KB budget once inline module bytes are included', () => {
    const report = computeBudgetReport({ distDir, budgetBytes: DEFAULT_BUDGET_BYTES })
    expect(report.passed).toBe(report.budgetedBytes <= DEFAULT_BUDGET_BYTES)
    expect(report.passed).toBe(true)
  })
})
