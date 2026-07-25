#!/usr/bin/env node
// scripts/check-js-budget.mjs - CI gate on total gzipped JS a browser
// actually downloads on this site, enforced against the plan's Global
// Constraint of 150 KB gzipped total.
//
// MUST be reference-aware, not a glob over dist/**/*.js. Registering
// @astrojs/react makes `astro build` emit a React runtime chunk into
// dist/_astro/ that Vite's code-splitting may or may not wire into any
// HTML entry point, depending on whether a real island exists yet - a
// naive `sum(gzip(dist/**/*.js))` would charge the budget for
// whatever got emitted, not for what a browser fetches.
//
// The reverse trap is just as real and is the one this file is built
// around: Astro hydrates an island via a CUSTOM ELEMENT, not a
// <script src> tag -
//   <astro-island component-url="..." renderer-url="..." ...>
// A checker that looks only for <script src> and <link
// rel="modulepreload"> finds ZERO reachable JS on a page that mounts
// islands and reports a passing budget forever, even though a browser
// downloads real JS the moment the island hydrates. See
// assertNotSilentZero() below - a budget gate that cannot tell "no JS"
// from "I failed to find the JS" is worse than no gate, because it
// looks green.
//
// Algorithm:
//   1. Parse every dist/**/*.html file for all four reference forms
//      (extractReferences).
//   2. Resolve each reference to a file under dist/, deduplicating -
//      two islands sharing one renderer chunk must be counted once.
//   3. Transitively follow static `import ... from "..."` / `export
//      ... from "..."` specifiers inside each referenced file
//      (buildReachableSet), since a referenced entry chunk pulls in
//      its own dependencies exactly the way a browser's module loader
//      would.
//   4. Sum the gzipped size of that reachable set. That sum, not the
//      total bytes emitted under dist/_astro/, is the number compared
//      against the budget.
//   5. Report reachable AND total-emitted separately, plus a per-file
//      breakdown and an explicit list of emitted-but-unreachable
//      files, so an orphan chunk can never quietly start counting
//      against the budget without someone noticing the report change.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// 150 KB gzipped, per the plan's Global Constraints. "KB" is treated
// as 1024 bytes (KiB), the conventional unit for a web-perf budget.
export const DEFAULT_BUDGET_BYTES = 150 * 1024

/**
 * Thrown when the built HTML contains an <astro-island> element (so a
 * browser WILL fetch and hydrate something) but reference extraction
 * computed zero reachable bytes. This is never a legitimate result -
 * an island with nothing to hydrate is not a page a browser can
 * render correctly - so it means extraction itself is broken, and
 * reporting a passing 0 KB budget in that state would be a false
 * negative on the one thing this script exists to catch.
 */
export class SilentZeroBudgetError extends Error {}

/** True if `html` mounts at least one Astro island. Case-insensitive
 * and tag-only (does not require a full, well-formed tag) so it stays
 * a reliable structural signal even if the attribute-level extraction
 * below has a bug - the two checks are deliberately independent. */
export function hasAstroIsland(html) {
  return /<astro-island\b/i.test(html)
}

// Generic "parse the attributes out of one already-matched tag" helper.
// Astro's own output always double-quotes attribute values (verified
// against this repo's real dist/index.html), so double-quote-only
// parsing is sufficient here - it is not meant to be a general HTML
// attribute parser.
function parseAttrs(tag) {
  const attrs = {}
  const re = /([\w-]+)\s*=\s*"([^"]*)"/g
  let match
  while ((match = re.exec(tag))) {
    attrs[match[1].toLowerCase()] = match[2]
  }
  return attrs
}

// The three astro-island attributes that can each carry a chunk a
// browser will fetch to hydrate that island.
const ASTRO_ISLAND_URL_ATTRS = ['component-url', 'renderer-url', 'before-hydration-url']

/**
 * Extract every raw reference string (root-relative paths like
 * "/_astro/foo.abc123.js") that a browser could actually fetch,
 * across all four reference forms:
 *   - <astro-island component-url="..." renderer-url="..."
 *     before-hydration-url="...">  (the form that matters for this
 *     site's hydration - see the module header)
 *   - <script src="..."> and <script type="module" src="...">
 *   - <link rel="modulepreload" href="...">
 *
 * Returns a deduplicated array; order is not meaningful to callers.
 */
export function extractReferences(html) {
  const refs = new Set()

  for (const tag of html.match(/<astro-island\b[^>]*>/gi) ?? []) {
    const attrs = parseAttrs(tag)
    for (const attrName of ASTRO_ISLAND_URL_ATTRS) {
      if (attrs[attrName]) refs.add(attrs[attrName])
    }
  }

  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    const attrs = parseAttrs(tag)
    if (attrs.src) refs.add(attrs.src)
  }

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = parseAttrs(tag)
    const rels = (attrs.rel ?? '').split(/\s+/)
    if (rels.includes('modulepreload') && attrs.href) refs.add(attrs.href)
  }

  return [...refs]
}

/**
 * Throw SilentZeroBudgetError if `hasIsland` is true but
 * `reachableByteTotal` is zero. Deliberately takes primitives rather
 * than re-deriving either value itself, so it stays a pure structural
 * invariant check independent of whatever bug might exist in
 * extraction - it does not matter WHY the reachable set came back
 * empty, only that an island with zero reachable bytes is never a
 * legitimate report.
 */
export function assertNotSilentZero(hasIsland, reachableByteTotal) {
  if (hasIsland && reachableByteTotal === 0) {
    throw new SilentZeroBudgetError(
      'dist HTML contains an <astro-island> element, but the computed reachable JS set is ' +
        'empty. This is the silent-zero failure mode: a broken reference extractor can report ' +
        'a passing 0 KB budget while a browser still downloads real JS on hydration. Fix the ' +
        'extractor - do not lower or remove this guard.',
    )
  }
}

/** Resolve a root-relative reference (e.g. "/_astro/foo.js") to an
 * absolute path under `distDir`. Every reference this site emits is
 * root-relative because `base` is "/" (a GitHub Pages user site) - a
 * reference that is NOT root-relative would mean an unexpected
 * external script, so it throws rather than silently resolving
 * something wrong or being skipped. */
function resolveDistRef(distDir, ref) {
  if (!ref.startsWith('/')) {
    throw new Error(
      `unexpected non-root-relative JS reference "${ref}": every reference this site emits ` +
        'should be root-relative (base is "/"); an external reference is not budgeted here',
    )
  }
  const resolved = join(distDir, ref.slice(1))
  if (!existsSync(resolved)) {
    throw new Error(`referenced file does not exist on disk: ${ref} (resolved to ${resolved})`)
  }
  return resolved
}

// Matches a static `import ... from "..."` or `export ... from "..."`
// specifier inside already-built (minified, single-line) JS. Astro's
// static output never uses dynamic `import()` for these entry chunks,
// so following only the static form matches what the plan's algorithm
// step 3 asks for.
const IMPORT_FROM_RE = /\b(?:import|export)\b[^'"()]*?\bfrom\s*["']([^"']+)["']/g

/** Return every static import/export specifier found in `jsSource`. */
export function extractImportSpecifiers(jsSource) {
  const specifiers = []
  const re = new RegExp(IMPORT_FROM_RE)
  let match
  while ((match = re.exec(jsSource))) {
    specifiers.push(match[1])
  }
  return specifiers
}

/**
 * Build the full transitive closure of files reachable from
 * `rootFiles` (absolute paths already resolved from HTML references),
 * following static import/export specifiers inside each .js file.
 * Non-.js files (css, fonts referenced some other way) are included as
 * leaves but not scanned for imports.
 *
 * Deduplicates via the Set itself - two islands sharing one renderer
 * chunk, or two chunks both importing the same shared dependency, are
 * each counted exactly once no matter how many times they are
 * referenced or imported.
 */
export function buildReachableSet(distDir, rootFiles) {
  const reachable = new Set()
  const queue = [...rootFiles]

  while (queue.length > 0) {
    const file = queue.shift()
    if (reachable.has(file)) continue
    reachable.add(file)
    if (!file.endsWith('.js')) continue

    const source = readFileSync(file, 'utf8')
    for (const spec of extractImportSpecifiers(source)) {
      // Only follow local (relative or root-relative) specifiers. A
      // bare specifier (an npm package name) would mean something
      // escaped Vite's bundling entirely, which never happens in this
      // static build - skip rather than mis-resolve it as a path.
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue
      const resolvedSpec = spec.startsWith('/') ? join(distDir, spec.slice(1)) : resolve(dirname(file), spec)
      if (!reachable.has(resolvedSpec)) queue.push(resolvedSpec)
    }
  }

  return reachable
}

// Small per-run cache so a file referenced from multiple call sites
// (e.g. both the reachable-set sum and the per-file breakdown) is only
// gzipped once.
const gzipSizeCache = new Map()

/** Gzipped byte size of the file at `filePath`, cached per process. */
export function gzipSizeOf(filePath) {
  if (!gzipSizeCache.has(filePath)) {
    gzipSizeCache.set(filePath, gzipSync(readFileSync(filePath)).length)
  }
  return gzipSizeCache.get(filePath)
}

/** Every *.html file under `distDir`, recursive, as absolute paths. */
function listHtmlFiles(distDir) {
  return readdirSync(distDir, { recursive: true })
    .filter((entry) => entry.endsWith('.html'))
    .map((entry) => join(distDir, entry))
    .sort()
}

/** Every *.js file under `distDir`, recursive, as absolute paths - the
 * "total emitted" side of the report, independent of reachability. */
function listEmittedJsFiles(distDir) {
  return readdirSync(distDir, { recursive: true })
    .filter((entry) => entry.endsWith('.js'))
    .map((entry) => join(distDir, entry))
    .sort()
}

/**
 * Compute the full budget report for the build at `distDir`.
 *
 * Throws SilentZeroBudgetError if any built HTML page mounts an
 * astro-island but the computed reachable set is empty (see
 * assertNotSilentZero above) - this is a hard stop, not a field in the
 * returned report, because a caller that only checks `.passed` would
 * otherwise treat a broken extractor identically to a genuinely tiny
 * bundle.
 *
 * Returns { budgetBytes, reachableBytes, totalEmittedBytes,
 * reachableFiles, unreachableFiles, passed }, where reachableFiles and
 * unreachableFiles are [{ file, bytes }] with `file` relative to
 * distDir, sorted by path.
 */
export function computeBudgetReport({ distDir, budgetBytes = DEFAULT_BUDGET_BYTES }) {
  // Absolutize once, up front. buildReachableSet's transitive-import
  // step resolves relative specifiers via path.resolve(), which always
  // returns an absolute path - if distDir itself were left relative,
  // the SAME file would end up keyed under two different string forms
  // depending on whether it was discovered as a direct HTML reference
  // (relative-in, relative-out via join) or as a transitive import
  // (relative-in, absolute-out via resolve), silently splitting one
  // file's identity across both the reachable and unreachable sets.
  // Caught by tests/checkJsBudget.test.ts's overlap check.
  distDir = resolve(distDir)
  const htmlFiles = listHtmlFiles(distDir)

  const allRefs = new Set()
  let anyIsland = false
  for (const htmlFile of htmlFiles) {
    const html = readFileSync(htmlFile, 'utf8')
    if (hasAstroIsland(html)) anyIsland = true
    for (const ref of extractReferences(html)) allRefs.add(ref)
  }

  const rootFiles = [...allRefs].map((ref) => resolveDistRef(distDir, ref))
  const reachableSet = buildReachableSet(distDir, rootFiles)
  const reachableJsFiles = [...reachableSet].filter((file) => file.endsWith('.js')).sort()
  const reachableBytes = reachableJsFiles.reduce((sum, file) => sum + gzipSizeOf(file), 0)

  // The hard stop: never let a silent-zero result reach the `passed`
  // field as an ordinary passing report.
  assertNotSilentZero(anyIsland, reachableBytes)

  const emittedJsFiles = listEmittedJsFiles(distDir)
  const totalEmittedBytes = emittedJsFiles.reduce((sum, file) => sum + gzipSizeOf(file), 0)
  const unreachableJsFiles = emittedJsFiles.filter((file) => !reachableSet.has(file))

  const toEntry = (file) => ({ file: relative(distDir, file).split(sep).join('/'), bytes: gzipSizeOf(file) })

  return {
    budgetBytes,
    reachableBytes,
    totalEmittedBytes,
    reachableFiles: reachableJsFiles.map(toEntry),
    unreachableFiles: unreachableJsFiles.map(toEntry),
    passed: reachableBytes <= budgetBytes,
  }
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

function printReport(report) {
  console.log('JS budget check (reachable-set only, see scripts/check-js-budget.mjs)')
  console.log('')
  console.log(`  reachable (budgeted):  ${formatKb(report.reachableBytes)} gzipped`)
  console.log(`  budget:                ${formatKb(report.budgetBytes)} gzipped`)
  console.log(`  total emitted:         ${formatKb(report.totalEmittedBytes)} gzipped (informational)`)
  console.log('')
  console.log('  reachable files:')
  for (const entry of report.reachableFiles) {
    console.log(`    ${formatKb(entry.bytes).padStart(10)}  ${entry.file}`)
  }
  if (report.unreachableFiles.length > 0) {
    console.log('')
    console.log('  emitted but UNREACHABLE (not counted against the budget):')
    for (const entry of report.unreachableFiles) {
      console.log(`    ${formatKb(entry.bytes).padStart(10)}  ${entry.file}`)
    }
  } else {
    console.log('')
    console.log('  emitted but unreachable: none')
  }
  console.log('')
  console.log(report.passed ? 'PASS' : 'FAIL: reachable JS exceeds the budget')
}

function main() {
  const distDir = resolve(process.cwd(), 'dist')
  let report
  try {
    report = computeBudgetReport({ distDir })
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
