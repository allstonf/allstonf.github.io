#!/usr/bin/env node
// scripts/check-js-budget.mjs - CI gate on the total gzipped JS a
// browser actually downloads on this site, enforced against the
// plan's Global Constraint of 150 KB gzipped total.
//
// SCOPE: the budgeted total combines two sources of JS a browser
// downloads as part of loading a page:
//   1. External script FILES reachable from the built HTML (an
//      astro-island hydration chunk, a <script src>, or a
//      modulepreload target), including their transitive static
//      imports. See "reachableBytes" below.
//   2. Inline <script type="module"> bodies emitted directly into the
//      HTML response itself - these never appear as a file to
//      resolve, but they are still JS the browser parses and runs the
//      moment the page loads, so they count exactly the same as an
//      external file toward the budget. See "inlineModuleBytes"
//      below.
// The sum of both is "budgetedBytes", the number actually compared
// against the budget. A plain data block such as a JSON-LD
// <script type="application/ld+json"> is not executable JS and is
// correctly excluded, and a classic inline <script> with no `type`
// attribute is also not counted here (it is real JS too, but outside
// this task's scope - see extractInlineModuleScripts's doc comment).
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
//   1. Parse every dist/**/*.html file for all four external
//      reference forms (extractReferences), AND for every inline
//      <script type="module"> body with no src (extractInlineModuleScripts).
//   2. Resolve each external reference to a file under dist/,
//      deduplicating - two islands sharing one renderer chunk must be
//      counted once.
//   3. Transitively follow static `import ... from "..."` / `export
//      ... from "..."` specifiers inside each referenced file
//      (buildReachableSet), since a referenced entry chunk pulls in
//      its own dependencies exactly the way a browser's module loader
//      would.
//   4. Sum the gzipped size of that external reachable set
//      (reachableBytes) and the gzipped size of every inline module
//      body (inlineModuleBytes). Their total, budgetedBytes, is the
//      number compared against the budget.
//   5. Report reachableBytes, inlineModuleBytes, budgetedBytes, and
//      total-emitted-file-bytes separately, plus a per-file breakdown
//      and an explicit list of emitted-but-unreachable files, so an
//      orphan chunk can never quietly start counting against the
//      budget without someone noticing the report change.

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
 * Extract the raw source text of every inline <script type="module">
 * that has NO src attribute, across `html`.
 *
 * Scope is deliberately narrow, matching what the header documents:
 *   - A module script WITH a src attribute is not returned here - it
 *     is an external file already covered by extractReferences /
 *     buildReachableSet, and returning its (empty) inline body too
 *     would not double count bytes, but skipping it keeps this
 *     function's contract simple: "the inline JS text a browser must
 *     parse that extractReferences cannot see."
 *   - A <script type="application/ld+json"> or any other non-module
 *     type is not returned - it is data, not executable JS.
 *   - A classic inline <script> with no type attribute at all is also
 *     not returned. It IS real executable JS, but this task's scope is
 *     specifically inline MODULE scripts; closing that gap for
 *     classic inline scripts is a separate, undocumented exclusion
 *     left for a future pass, not silently folded in here.
 *
 * Returns an array of raw strings (script bodies), in document order;
 * duplicates are not deduplicated because two inline scripts with
 * identical text still both download and execute as separate bytes.
 */
export function extractInlineModuleScripts(html) {
  const bodies = []
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let match
  while ((match = re.exec(html))) {
    const attrs = parseAttrs(`<script${match[1]}>`)
    if ((attrs.type ?? '').toLowerCase() === 'module' && !attrs.src) {
      bodies.push(match[2])
    }
  }
  return bodies
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

/** Gzipped byte size of an in-memory string. Used for inline module
 * script bodies, which have no file on disk to hand to gzipSizeOf. */
export function gzipSizeOfString(source) {
  return gzipSync(Buffer.from(source, 'utf8')).length
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
 * bundle. Note this guard is checked against `reachableBytes` (the
 * external-file set) only, not `budgetedBytes` - an inline module
 * script existing elsewhere on the page says nothing about whether
 * island-reference extraction itself is broken.
 *
 * Returns { budgetBytes, reachableBytes, inlineModuleBytes,
 * budgetedBytes, totalEmittedBytes, reachableFiles, inlineModuleFiles,
 * unreachableFiles, passed }.
 *   - reachableBytes keeps its original, narrower meaning: the gzipped
 *     sum of the external-file reachable set only. This is
 *     deliberately NOT redefined to include inline bytes, so existing
 *     callers that reason about "the reachable file set" (e.g. the
 *     unreachable-file diff) keep working unchanged.
 *   - inlineModuleBytes is the gzipped sum of every inline
 *     <script type="module"> body found across all built HTML pages.
 *   - budgetedBytes = reachableBytes + inlineModuleBytes. This, not
 *     reachableBytes alone, is the number compared against the
 *     budget, because both are real JS a browser downloads as part of
 *     loading the page.
 *   - reachableFiles, unreachableFiles are [{ file, bytes }] with
 *     `file` relative to distDir, sorted by path.
 *   - inlineModuleFiles is [{ file, bytes }] with `file` naming the
 *     HTML page and a 1-based index of the inline module within it
 *     (e.g. "index.html#inline-module-1"), since an inline script has
 *     no path of its own on disk.
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
  const inlineModuleFiles = []
  for (const htmlFile of htmlFiles) {
    const html = readFileSync(htmlFile, 'utf8')
    if (hasAstroIsland(html)) anyIsland = true
    for (const ref of extractReferences(html)) allRefs.add(ref)

    // Inline module scripts have no file identity of their own, so
    // they are gzipped directly from their source text and reported
    // against the HTML page that emitted them, with a 1-based index
    // to disambiguate multiple inline modules on the same page.
    const htmlLabel = relative(distDir, htmlFile).split(sep).join('/')
    extractInlineModuleScripts(html).forEach((source, index) => {
      inlineModuleFiles.push({
        file: `${htmlLabel}#inline-module-${index + 1}`,
        bytes: gzipSizeOfString(source),
      })
    })
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

  const inlineModuleBytes = inlineModuleFiles.reduce((sum, entry) => sum + entry.bytes, 0)
  const budgetedBytes = reachableBytes + inlineModuleBytes

  return {
    budgetBytes,
    reachableBytes,
    inlineModuleBytes,
    budgetedBytes,
    totalEmittedBytes,
    reachableFiles: reachableJsFiles.map(toEntry),
    inlineModuleFiles,
    unreachableFiles: unreachableJsFiles.map(toEntry),
    passed: budgetedBytes <= budgetBytes,
  }
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

function printReport(report) {
  console.log('JS budget check (external reachable set + inline module scripts, see scripts/check-js-budget.mjs)')
  console.log('')
  console.log(`  budgeted total:        ${formatKb(report.budgetedBytes)} gzipped`)
  console.log(`  budget:                ${formatKb(report.budgetBytes)} gzipped`)
  console.log(`    external reachable:  ${formatKb(report.reachableBytes)} gzipped`)
  console.log(`    inline modules:      ${formatKb(report.inlineModuleBytes)} gzipped`)
  console.log(`  total emitted:         ${formatKb(report.totalEmittedBytes)} gzipped (informational)`)
  console.log('')
  console.log('  reachable files:')
  for (const entry of report.reachableFiles) {
    console.log(`    ${formatKb(entry.bytes).padStart(10)}  ${entry.file}`)
  }
  if (report.inlineModuleFiles.length > 0) {
    console.log('')
    console.log('  inline module scripts:')
    for (const entry of report.inlineModuleFiles) {
      console.log(`    ${formatKb(entry.bytes).padStart(10)}  ${entry.file}`)
    }
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
  console.log(report.passed ? 'PASS' : 'FAIL: budgeted JS exceeds the budget')
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
