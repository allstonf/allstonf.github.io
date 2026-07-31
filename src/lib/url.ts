// src/lib/url.ts - fail-closed URL scheme validation.
//
// Ported from v1's build/build.py validate_url(). html.escape() (and
// Astro's equivalent automatic attribute escaping) neutralizes quotes
// and angle brackets, which stops an attribute breakout, but neither
// performs scheme validation: a value of "javascript:alert(1)" contains
// no character either touches, so it survives escaping intact and
// executes on click. Added to v1 in response to a code-review MUST FIX;
// the same gap exists in Astro's href={expr} interpolation, so every
// URL sink in index.astro (person.profiles[].url, projects[].links[].url,
// person.resume.url, site.url, and the JSON-LD worksFor.url) must run
// through validateUrl() before it reaches an href or a JSON-LD block.
//
// Unlike v1, this module exports no separate "escUrl" step. Astro
// HTML-escapes every attribute expression automatically at compile
// time (href={expr} behaves like a JSX attribute expression), so the
// only guarantee that still needs porting by hand is scheme validation.
// The JSON-LD sink (worksFor.url) needs validation WITHOUT
// HTML-escaping, since that value lands in JSON.stringify() output, not
// markup - validateUrl() alone satisfies that call site directly.

// URL schemes allowed to reach an href or a published JSON-LD url.
const ALLOWED_URL_SCHEMES = ['https:', 'http:', 'mailto:']

// Same-origin relative forms, which carry no scheme and are always
// safe. "//" is deliberately NOT here: a protocol-relative URL looks
// relative but leaves the origin entirely.
const RELATIVE_URL_PREFIXES = ['/', '#', './', '../']

// C0 control characters and space. Browsers strip these before parsing
// a URL scheme, so "java\tscript:" and " javascript:" are both live
// links, and the check has to normalize them away before comparing -
// otherwise a naive startsWith('javascript:') misses every obfuscated
// variant.
const URL_IGNORED_CHARS = /[\x00-\x20]/g

/**
 * Thrown when a URL cannot be published safely.
 *
 * Callers let this propagate and abort the Astro build rather than
 * catching it to silently defang or drop the link: a URL that fails
 * validation is an authoring mistake in content/profile.json, and a
 * loud build-time failure beats a silently rewritten link on a public
 * page.
 */
export class UnpublishableUrlError extends Error {}

/**
 * Return `value` normalized, or throw UnpublishableUrlError if it
 * cannot be published.
 *
 * Accepts an allowlisted scheme (https, http, mailto) or a same-origin
 * relative form. Rejects everything else, including a protocol-relative
 * "//host" URL that looks relative but leaves the origin, and a bare
 * "example.com" carrying no scheme at all.
 *
 * Returns the NORMALIZED string (C0 control characters and spaces
 * removed) so that the value which was checked is byte-for-byte the
 * value that ships. Otherwise a tab hidden inside an approved URL could
 * still change where a browser navigates, since browsers strip those
 * characters before parsing the scheme - render the return value, never
 * the original `value`.
 */
/**
 * Return `value` validated and, if it is a same-origin absolute path, joined
 * onto `siteUrl` so it can be resolved by a reader with no document base.
 *
 * For MACHINE surfaces only. dist/api/profile.json and dist/llms.txt are
 * fetched directly over HTTP rather than loaded as documents, and neither
 * carries an origin field a consumer could join a relative path to, so a bare
 * "/file.pdf" is unresolvable to exactly the readers those files exist for.
 * The human page keeps the relative href: a browser resolves it against the
 * document, which is the correct form there.
 *
 * Only a leading "/" is joined. A "#fragment" is meaningless without a document
 * and a "./" relative form has no unambiguous base here, so both are left alone
 * rather than silently rewritten into something that looks resolvable and is
 * not - the same fail-loudly-rather-than-guess reasoning as validateUrl itself.
 */
export function absolutizeUrl(value: unknown, siteUrl: string, field = 'url'): string {
  const url = validateUrl(value, field)
  if (!url.startsWith('/')) return url
  return `${validateUrl(siteUrl, 'site.url').replace(/\/+$/, '')}${url}`
}

export function validateUrl(value: unknown, field = 'url'): string {
  const cleaned = String(value).replace(URL_IGNORED_CHARS, '')
  const probe = cleaned.toLowerCase()

  if (probe.startsWith('//')) {
    throw new UnpublishableUrlError(
      `${field}: protocol-relative URL ${JSON.stringify(cleaned)} leaves the origin; ` +
        'give it an explicit https:// scheme',
    )
  }

  const isRelative = RELATIVE_URL_PREFIXES.some((prefix) => probe.startsWith(prefix))
  const isAllowedScheme = ALLOWED_URL_SCHEMES.some((scheme) => probe.startsWith(scheme))
  if (isRelative || isAllowedScheme) {
    return cleaned
  }

  throw new UnpublishableUrlError(
    `${field}: disallowed or missing URL scheme in ${JSON.stringify(cleaned)}; ` +
      `allowed schemes are ${ALLOWED_URL_SCHEMES.join(', ')} or a same-origin relative path`,
  )
}
