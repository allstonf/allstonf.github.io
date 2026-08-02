#!/usr/bin/env node
// scripts/check-css-budget.mjs - CI gate on the total gzipped CSS a
// browser actually downloads on this site, plus an informational
// report of selectors that appear in no built HTML and no built JS.
//
// This is the CSS counterpart to scripts/check-js-budget.mjs and
// deliberately mirrors its structure, its reference-awareness and its
// silent-zero guard. Written because removing the Loop section on
// 2026-07-31 dropped reachable JS from 65.1 KB to 0.9 KB and the JS
// gate reported it precisely, while the CSS side of the same removal
// was measured by nothing at all.
//
// SCOPE: two byte sources, summed into budgetedBytes.
//   1. External stylesheet FILES reachable from the built HTML via
//      <link rel="stylesheet">, plus their transitive @import chain.
//   2. Every inline <style> body, which never appears as a file to
//      resolve but is still CSS the browser parses on load.
//
// WHY REFERENCE-AWARE AND NOT A GLOB: a build can emit a stylesheet
// that no page links (Vite code-splitting, a removed page, a stale
// chunk). A sum over dist/**/*.css charges the budget for bytes no
// browser fetches, which makes the number unactionable.
//
// THE UNREFERENCED-SELECTOR LIST IS A REPORT, NOT A GATE. It never
// changes the exit code. Static analysis cannot see a class applied
// only through element.classList.add(...) at runtime, and this site
// has exactly that (src/lib/navMenu.ts, src/lib/viewToggle.ts), so
// the token scan below reads built JS and inline scripts as well as
// markup. Even so, a computed class name assembled from fragments
// would evade it. Failing the build on this list would be a
// false-positive machine; showing it makes the debt visible, which
// is the whole point.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

// 20 KB gzipped. The real build is currently ~3.4 KB gzipped, so this
// is roughly 6x headroom - loose enough that ordinary design work
// never trips it, tight enough that pulling in a CSS framework or
// leaving a whole deleted section's stylesheet behind does. The JS
// budget's 150 KB was set the same way, from the plan's stated
// ceiling rather than from the current number.
export const DEFAULT_BUDGET_BYTES = 20 * 1024

/**
 * Thrown when the built HTML links at least one stylesheet (so a
 * browser WILL fetch CSS) but reference extraction computed zero
 * reachable bytes. Never a legitimate result: it means extraction
 * itself is broken, and reporting a passing 0 KB in that state is a
 * false negative on the one thing this script exists to catch.
 */
export class SilentZeroBudgetError extends Error {}

// Astro's own output always double-quotes attribute values (verified
// against this repo's real dist/index.html), so double-quote-only
// parsing is sufficient. Not a general HTML attribute parser.
function parseAttrs(tag) {
  const attrs = {}
  // matchAll() rather than a re.exec() loop: it needs no shared
  // `lastIndex` state, avoiding the assign-in-expression pattern
  // Biome's noAssignInExpressions rule flags. Mirrors
  // check-js-budget.mjs's own parseAttrs.
  for (const match of tag.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
    attrs[match[1].toLowerCase()] = match[2]
  }
  return attrs
}

/**
 * Every stylesheet reference a browser would fetch from `html`.
 * Matches `rel` by TOKEN, not by string equality, because
 * `rel="preload stylesheet"` is a real and legal form that an
 * equality check would miss. Returns a deduplicated array.
 */
export function extractStylesheetRefs(html) {
  const refs = new Set()
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = parseAttrs(tag)
    const rels = (attrs.rel ?? '').toLowerCase().split(/\s+/)
    if (rels.includes('stylesheet') && attrs.href) refs.add(attrs.href)
  }
  return [...refs]
}

/**
 * The raw source of every inline <style> body in `html`, in document
 * order. NOT deduplicated: two identical style blocks still both ship
 * as separate bytes.
 */
export function extractInlineStyles(html) {
  const bodies = []
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    bodies.push(match[1])
  }
  return bodies
}

// Matches an @import in either legal form: @import "x.css" or
// @import url("x.css") / url(x.css). Anchored on @import so a
// background-image url() is not mistaken for a stylesheet - a trap
// a bare /url\(([^)]+)\)/ would fall straight into.
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?/g

/** Every @import specifier in `cssSource`. */
export function extractImportSpecifiers(cssSource) {
  // matchAll() rather than a re.exec() loop: it needs no shared
  // `lastIndex` state, so the module-level CSS_IMPORT_RE can be used
  // directly instead of being defensively re-constructed on every
  // call. Mirrors check-js-budget.mjs's extractImportSpecifiers.
  const specifiers = []
  for (const match of cssSource.matchAll(CSS_IMPORT_RE)) {
    specifiers.push(match[1])
  }
  return specifiers
}

/** Resolve a root-relative reference to a path under `distDir`. Every
 * reference this site emits is root-relative because `base` is "/"
 * (a GitHub Pages user site); a non-root-relative one would mean an
 * unexpected external stylesheet, so it throws rather than silently
 * resolving something wrong. */
function resolveDistRef(distDir, ref) {
  if (!ref.startsWith('/')) {
    throw new Error(
      `unexpected non-root-relative CSS reference "${ref}": every reference this site emits ` +
        'should be root-relative (base is "/"); an external reference is not budgeted here',
    )
  }
  const resolved = join(distDir, ref.slice(1))
  if (!existsSync(resolved)) {
    throw new Error(`referenced file does not exist on disk: ${ref} (resolved to ${resolved})`)
  }
  return resolved
}

/**
 * Transitive closure of files reachable from `rootFiles`, following
 * @import specifiers inside each .css file. Deduplicates via the Set,
 * so a shared import pulled in twice is counted once.
 */
export function buildReachableSet(distDir, rootFiles) {
  const reachable = new Set()
  const queue = [...rootFiles]
  while (queue.length > 0) {
    const file = queue.shift()
    if (reachable.has(file)) continue
    reachable.add(file)
    if (!file.endsWith('.css')) continue
    for (const spec of extractImportSpecifiers(readFileSync(file, 'utf8'))) {
      // Only follow local specifiers. A protocol-relative or absolute
      // URL is an external stylesheet, which this site emits none of
      // and does not budget.
      if (spec.startsWith('http') || spec.startsWith('//')) continue
      const resolved = spec.startsWith('/') ? join(distDir, spec.slice(1)) : resolve(dirname(file), spec)
      if (!reachable.has(resolved)) queue.push(resolved)
    }
  }
  return reachable
}

// A selector chunk we can meaningfully check for use: a class or an
// id. Element, universal, attribute and pseudo-element selectors are
// deliberately NOT reported, because "is <h1> used" is not a question
// this tool can answer usefully and a false positive there would make
// the whole report noise.
const CLASS_OR_ID_RE = /[.#][A-Za-z_][\w-]*/g

/**
 * Every distinct class (`.foo`) and id (`#bar`) selector appearing in
 * `cssSource`, with pseudo-classes, pseudo-elements, combinators and
 * attribute selectors discarded. Descends into at-rule blocks
 * (@media, @supports) because a selector inside one is just as real
 * as a top-level selector.
 *
 * @keyframes step selectors (`0%`, `from`, `to`) are naturally
 * excluded because none of them starts with `.` or `#`, and
 * declaration BODIES are skipped so a value like `#fff` in
 * `color: #fff` is never mistaken for an id selector - that specific
 * false positive is why this parses the prelude only.
 */
export function extractClassAndIdSelectors(cssSource) {
  const found = new Set()
  // Strip comments first, then walk the source tracking brace depth so
  // that only PRELUDES (the text before a `{`) are collected and every
  // declaration BODY is discarded. Parsing the prelude only is what
  // keeps `color: #fff` from being misread as an id selector - that
  // specific false positive is the reason this is a small state machine
  // rather than one regex over the whole file.
  const withoutComments = cssSource.replace(/\/\*[\s\S]*?\*\//g, '')
  const preludes = []
  let depth = 0
  let current = ''
  for (const char of withoutComments) {
    if (char === '{') {
      // EVERY prelude is captured, at every depth. An at-rule prelude
      // is filtered out below rather than here - filtering at capture
      // time is what made an earlier draft drop `.mob` from
      // `@media (...) { .mob { } }`, because by the time the inner
      // block opened, depth was already 2.
      depth += 1
      preludes.push(current)
      current = ''
      continue
    }
    if (char === '}') {
      depth = Math.max(0, depth - 1)
      current = ''
      continue
    }
    current += char
    // Inside a block, a `;` ends a declaration; reset so declaration
    // text can never accumulate into the next prelude.
    if (depth > 0 && char === ';') current = ''
  }
  for (const prelude of preludes) {
    // An at-rule prelude (@media (max-width: 600px), @supports (...))
    // carries no class or id selector of its own.
    if (prelude.trim().startsWith('@')) continue
    // Attribute selectors can legally contain a `#` inside a quoted
    // value ([data-anchor="#top"]), which the class/id pattern would
    // otherwise report as an id selector that does not exist.
    const withoutAttrSelectors = prelude.replace(/\[[^\]]*\]/g, '')
    for (const match of withoutAttrSelectors.match(CLASS_OR_ID_RE) ?? []) found.add(match)
  }
  return [...found].sort()
}

// Any identifier-shaped run. Used to build the "referenced" set from
// markup AND from JS, so a class that only ever appears as a string
// literal in navMenu.ts still counts as referenced.
const TOKEN_RE = /[A-Za-z_][\w-]*/g

/** Every identifier-shaped token in `text`, as a Set-ready array. */
export function extractReferencedTokens(text) {
  return text.match(TOKEN_RE) ?? []
}

/**
 * Throw SilentZeroBudgetError if `hasStylesheetRef` is true but
 * `reachableByteTotal` is zero. Takes primitives rather than
 * re-deriving either value, so it stays a structural invariant check
 * independent of whatever bug might exist in extraction.
 */
export function assertNotSilentZero(hasStylesheetRef, reachableByteTotal) {
  if (hasStylesheetRef && reachableByteTotal === 0) {
    throw new SilentZeroBudgetError(
      'dist HTML links at least one stylesheet, but the computed reachable CSS set is empty. ' +
        'This is the silent-zero failure mode: a broken reference extractor can report a ' +
        'passing 0 KB budget while a browser still downloads real CSS. Fix the extractor - do ' +
        'not lower or remove this guard.',
    )
  }
}

const gzipSizeCache = new Map()

/** Gzipped byte size of a file, cached per process. */
export function gzipSizeOf(filePath) {
  if (!gzipSizeCache.has(filePath)) {
    gzipSizeCache.set(filePath, gzipSync(readFileSync(filePath)).length)
  }
  return gzipSizeCache.get(filePath)
}

/** Gzipped byte size of an in-memory string. */
export function gzipSizeOfString(source) {
  return gzipSync(Buffer.from(source, 'utf8')).length
}

function listByExtension(distDir, ext) {
  return readdirSync(distDir, { recursive: true })
    .filter((entry) => entry.endsWith(ext))
    .map((entry) => join(distDir, entry))
    .sort()
}

/**
 * Full CSS budget report for the build at `distDir`.
 *
 * Throws SilentZeroBudgetError (see assertNotSilentZero) rather than
 * returning it as a field, because a caller that only checks `.passed`
 * would otherwise treat a broken extractor identically to a genuinely
 * tiny stylesheet.
 */
export function computeCssBudgetReport({ distDir, budgetBytes = DEFAULT_BUDGET_BYTES }) {
  distDir = resolve(distDir)
  const htmlFiles = listByExtension(distDir, '.html')

  const allRefs = new Set()
  let anyStylesheetRef = false
  const inlineStyleBlocks = []
  // The corpus the unreferenced-selector report checks against:
  // every built HTML file plus every built JS file, because a class
  // can be applied at runtime and never appear in markup.
  let referenceCorpus = ''

  for (const htmlFile of htmlFiles) {
    const html = readFileSync(htmlFile, 'utf8')
    const refs = extractStylesheetRefs(html)
    if (refs.length > 0) anyStylesheetRef = true
    for (const ref of refs) allRefs.add(ref)

    const htmlLabel = relative(distDir, htmlFile).split(sep).join('/')
    extractInlineStyles(html).forEach((source, index) => {
      inlineStyleBlocks.push({
        file: `${htmlLabel}#inline-style-${index + 1}`,
        bytes: gzipSizeOfString(source),
      })
    })
    referenceCorpus += `\n${html}`
  }

  for (const jsFile of listByExtension(distDir, '.js')) {
    referenceCorpus += `\n${readFileSync(jsFile, 'utf8')}`
  }

  const rootFiles = [...allRefs].map((ref) => resolveDistRef(distDir, ref))
  const reachableSet = buildReachableSet(distDir, rootFiles)
  const reachableCssFiles = [...reachableSet].filter((f) => f.endsWith('.css')).sort()
  const reachableBytes = reachableCssFiles.reduce((sum, f) => sum + gzipSizeOf(f), 0)

  assertNotSilentZero(anyStylesheetRef, reachableBytes)

  const emittedCssFiles = listByExtension(distDir, '.css')
  const totalEmittedBytes = emittedCssFiles.reduce((sum, f) => sum + gzipSizeOf(f), 0)
  const unreachableCssFiles = emittedCssFiles.filter((f) => !reachableSet.has(f))

  // Selector report: over the REACHABLE css only. A selector in an
  // orphan file is already reported by the unreachable-file list, and
  // reporting it twice would overstate the finding.
  const referencedTokens = new Set(extractReferencedTokens(referenceCorpus))
  const selectors = new Set()
  for (const file of reachableCssFiles) {
    for (const sel of extractClassAndIdSelectors(readFileSync(file, 'utf8'))) selectors.add(sel)
  }
  const unreferencedSelectors = [...selectors].filter((sel) => !referencedTokens.has(sel.slice(1))).sort()

  const toEntry = (f) => ({ file: relative(distDir, f).split(sep).join('/'), bytes: gzipSizeOf(f) })
  const inlineStyleBytes = inlineStyleBlocks.reduce((sum, e) => sum + e.bytes, 0)
  const budgetedBytes = reachableBytes + inlineStyleBytes

  return {
    budgetBytes,
    reachableBytes,
    inlineStyleBytes,
    budgetedBytes,
    totalEmittedBytes,
    reachableFiles: reachableCssFiles.map(toEntry),
    inlineStyleBlocks,
    unreachableFiles: unreachableCssFiles.map(toEntry),
    unreferencedSelectors,
    passed: budgetedBytes <= budgetBytes,
  }
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

function printReport(report) {
  console.log('CSS budget check (reachable stylesheets + inline styles, see scripts/check-css-budget.mjs)')
  console.log('')
  console.log(`  budgeted total:        ${formatKb(report.budgetedBytes)} gzipped`)
  console.log(`  budget:                ${formatKb(report.budgetBytes)} gzipped`)
  console.log(`    external reachable:  ${formatKb(report.reachableBytes)} gzipped`)
  console.log(`    inline styles:       ${formatKb(report.inlineStyleBytes)} gzipped`)
  console.log(`  total emitted:         ${formatKb(report.totalEmittedBytes)} gzipped (informational)`)
  console.log('')
  console.log('  reachable files:')
  for (const entry of report.reachableFiles) {
    console.log(`    ${formatKb(entry.bytes).padStart(10)}  ${entry.file}`)
  }
  if (report.inlineStyleBlocks.length > 0) {
    console.log('')
    console.log('  inline styles:')
    for (const entry of report.inlineStyleBlocks) {
      console.log(`    ${formatKb(entry.bytes).padStart(10)}  ${entry.file}`)
    }
  }
  console.log('')
  if (report.unreachableFiles.length > 0) {
    console.log('  emitted but UNREACHABLE (not counted against the budget):')
    for (const entry of report.unreachableFiles) {
      console.log(`    ${formatKb(entry.bytes).padStart(10)}  ${entry.file}`)
    }
  } else {
    console.log('  emitted but unreachable: none')
  }
  console.log('')
  console.log(
    `  selectors in reachable CSS matching no token in any built HTML or JS: ${report.unreferencedSelectors.length}`,
  )
  console.log('  (INFORMATIONAL - never changes the exit code. A class applied only via')
  console.log('   classList.add at runtime is found through the JS scan, but a class name')
  console.log('   assembled from string fragments would still be listed here wrongly.)')
  for (const sel of report.unreferencedSelectors) {
    console.log(`    ${sel}`)
  }
  console.log('')
  console.log(report.passed ? 'PASS' : 'FAIL: budgeted CSS exceeds the budget')
}

function main() {
  const distDir = resolve(process.cwd(), 'dist')
  let report
  try {
    report = computeCssBudgetReport({ distDir })
  } catch (error) {
    if (error instanceof SilentZeroBudgetError) {
      console.error('FATAL: silent-zero guard tripped')
      console.error(error.message)
      process.exitCode = 1
      return
    }
    throw error
  }
  printReport(report)
  process.exitCode = report.passed ? 0 : 1
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMainModule) {
  main()
}
