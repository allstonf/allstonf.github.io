// tests/artifactHygiene.test.ts - two binding constraints the final
// whole-branch review found had zero test coverage: (a) zero external
// network requests, and (b) zero em-dash bytes, across every built
// text artifact (not just dist/index.html, which parity.test.ts
// already guards). Both properties were verified TRUE by hand at
// review time, but nothing would catch a future regression - e.g. a
// stray `@import url(fonts.googleapis.com/...)` in a stylesheet, or an
// em-dash slipping into llms.txt while dist/index.html stays clean.
//
// Reads real build output under dist/, the same pattern
// parity.test.ts and agentSurface.test.ts already use: run
// `npx astro build` before running this suite.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const EM_DASH = String.fromCharCode(8212)

/** Recursively collect every file under `dir` whose name ends with `extension`. */
function listFilesRecursive(dir: string, extension: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      results.push(...listFilesRecursive(full, extension))
    } else if (entry.endsWith(extension)) {
      results.push(full)
    }
  }
  return results
}

// Namespace/reference URIs that legitimately appear as plain string
// values (a JSON-LD @context, a sitemap.xml xmlns) rather than
// something a browser or crawler dereferences while loading this page.
// Kept as an explicit allowlist so the scanner below stays honest about
// WHY something is excluded, even though in practice none of this
// site's fetching-context attributes currently carry one of these.
const NAMESPACE_ALLOWLIST = ['schema.org', 'w3.org', 'sitemaps.org']

function isAllowedNamespaceUrl(url: string): boolean {
  return NAMESPACE_ALLOWLIST.some((host) => url.includes(host))
}

/**
 * Extract every external (http/https) URL that appears in a FETCHING
 * CONTEXT inside an HTML document: a <script src="...">, or a
 * <link href="..."> whose rel is one a browser dereferences
 * automatically on page load (stylesheet, preload, modulepreload,
 * icon). Deliberately narrow: a plain <a href="...">, a
 * <link rel="canonical">, and an Open Graph
 * <meta property="og:..." content="..."> are NOT fetching contexts -
 * none of them trigger an automatic network request - so they must NOT
 * be flagged even though they carry an external URL string. Being
 * precise about what counts as "fetching" is what keeps this test
 * meaningful instead of either missing real leaks or crying wolf on
 * ordinary outbound links (github.com, linkedin.com, ucsd.edu, the
 * resume host) this page is supposed to link to.
 */
function findFetchingContextUrls(html: string): string[] {
  const urls: string[] = []

  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/gi)) {
    urls.push(match[1])
  }

  // Re-parse each <link ...> tag on its own rather than one combined
  // regex, since HTML attribute order is not guaranteed - `rel` can
  // appear before or after `href`.
  const fetchedRels = new Set(['stylesheet', 'preload', 'modulepreload', 'icon'])
  for (const tagMatch of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = tagMatch[0]
    const relMatch = tag.match(/\brel=["']([^"']+)["']/i)
    const hrefMatch = tag.match(/\bhref=["'](https?:\/\/[^"']+)["']/i)
    if (relMatch && hrefMatch && fetchedRels.has(relMatch[1].toLowerCase())) {
      urls.push(hrefMatch[1])
    }
  }

  return urls
}

/** Extract every external CSS url(...) reference (@font-face src, @import, background-image, etc). */
function findCssUrls(css: string): string[] {
  const urls: string[] = []
  for (const match of css.matchAll(/url\(\s*['"]?(https?:\/\/[^'")]+)['"]?\s*\)/gi)) {
    urls.push(match[1])
  }
  return urls
}

describe('zero external network requests - built artifacts never fetch off-origin', () => {
  it('sanity check: the scanner catches a script/stylesheet reference but not an <a href>, canonical link, or OG meta', () => {
    // Verify the scanner ITSELF against a synthetic fixture before
    // trusting it against the real dist/ output below. Without this,
    // a scanner bug that matched nothing would make every assertion in
    // the next two tests pass for the wrong reason - a trivially
    // passing test, which is exactly what this fix exists to avoid.
    const fixture = `
      <script src="https://evil.example/inject.js"></script>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css">
      <link rel="canonical" href="https://allstonf.github.io/">
      <a href="https://github.com/allstoncodes">GitHub</a>
      <meta property="og:image" content="https://allstonf.github.io/og.png">
    `
    const found = findFetchingContextUrls(fixture)
    expect(found).toContain('https://evil.example/inject.js')
    expect(found).toContain('https://fonts.googleapis.com/css')
    expect(found).not.toContain('https://allstonf.github.io/')
    expect(found).not.toContain('https://github.com/allstoncodes')
    expect(found).not.toContain('https://allstonf.github.io/og.png')
  })

  it('every built HTML file has zero external script/stylesheet/preload/icon references', () => {
    const htmlFiles = listFilesRecursive('dist', '.html')
    expect(htmlFiles.length).toBeGreaterThan(0)
    for (const file of htmlFiles) {
      const offenders = findFetchingContextUrls(readFileSync(file, 'utf8')).filter(
        (url) => !isAllowedNamespaceUrl(url),
      )
      expect(offenders, `${file} fetches external URL(s): ${offenders.join(', ')}`).toEqual([])
    }
  })

  it('every built CSS file has zero external url() references', () => {
    const cssFiles = listFilesRecursive('dist', '.css')
    expect(cssFiles.length).toBeGreaterThan(0)
    for (const file of cssFiles) {
      const offenders = findCssUrls(readFileSync(file, 'utf8')).filter(
        (url) => !isAllowedNamespaceUrl(url),
      )
      expect(offenders, `${file} references external url(): ${offenders.join(', ')}`).toEqual([])
    }
  })
})

describe('zero em-dash bytes across every generated text artifact, not just dist/index.html', () => {
  // parity.test.ts already guards dist/index.html alone; this sweep
  // extends the same check to every other text file the build emits,
  // per the review finding that llms.txt / llms-full.txt / index.md /
  // robots.txt / sitemap.xml / api/profile.json were all unguarded.
  const artifacts = [
    'dist/index.html',
    'dist/index.md',
    'dist/llms.txt',
    'dist/llms-full.txt',
    'dist/robots.txt',
    'dist/sitemap.xml',
    'dist/api/profile.json',
  ]

  it.each(artifacts)('%s ships no em-dash', (path) => {
    expect(readFileSync(path, 'utf8')).not.toContain(EM_DASH)
  })
})
