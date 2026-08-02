// src/lib/jsonLd.ts - builds the schema.org JSON-LD graph embedded in
// index.astro's <script type="application/ld+json"> block.
//
// Extracted out of index.astro's frontmatter into a standalone,
// importable function - the same reason v1's build.py build_json_ld()
// is a standalone function returning a dict rather than inline
// construction, per that function's own docstring: "so callers can
// also unit test its shape directly, separately from the JSON-encoding
// and </script>-escaping." An inline Astro frontmatter object literal
// cannot be imported by a test at all, which is exactly how a missing
// validateUrl() call on person.education.institution_url went
// undetected in the first pass of this port until an adversarial
// review caught it by hand (javascript:alert(1) reached
// dist/index.html's JSON-LD block verbatim, with build exit 0).
//
// Every URL reachable from this object runs through validateUrl()
// WITHOUT HTML-escaping, since the returned object is JSON.stringify'd
// by the caller, never rendered as markup - see src/lib/url.ts for why
// that split matters (a URL sink headed into JSON needs scheme
// validation but not HTML-entity escaping, unlike an href).
//
// Task 6 (AEO/GEO hardening) restructured the single top-level Person
// object into a schema.org "@graph" of two linked nodes:
//   - Person, now carrying a stable "@id" (<site.url>/#person) so an
//     agent has a durable anchor to dedupe this entity against, instead
//     of re-deriving identity from name matching alone.
//   - WebSite, a new node with its own "@id" (<site.url>/#website)
//     whose publisher and about both point back at the Person node via
//     "@id" reference - the standard schema.org pattern for tying
//     multiple entities appearing on one page together, and the piece
//     that was entirely missing before this task (a bare Person object
//     has nothing forcing two mentions of "Allston Fojas" on the web to
//     resolve to the same node).
// Per the evidence basis for this task: two independent controlled
// tests found ChatGPT, Claude, and Perplexity do not reliably parse
// JSON-LD during a live fetch (only Gemini does), so this hardening is
// aimed at Google's index and entity disambiguation, not at agents
// reading the page directly - the VISIBLE page carries the same facts
// in prose, per index.astro's own header comment.
import { validateUrl } from './url'

export function buildJsonLd(profile: any, lastUpdated: string = profile._meta.last_updated): Record<string, unknown> {
  const { person, site } = profile
  const currentRole = person.current_role
  const education = person.education

  const siteUrl = validateUrl(site.url, 'site.url')
  const personId = `${siteUrl}/#person`
  const websiteId = `${siteUrl}/#website`

  const personNode: Record<string, unknown> = {
    '@type': 'Person',
    '@id': personId,
    name: person.name,
    jobTitle: currentRole.title,
    worksFor: {
      '@type': 'Organization',
      name: currentRole.employer,
      // Not an href, but an agent following worksFor.url deserves the
      // same scheme guarantee a human clicking a link gets.
      ...(currentRole.employer_url
        ? { url: validateUrl(currentRole.employer_url, 'person.current_role.employer_url') }
        : {}),
    },
    knowsAbout: person.knows_about ?? [],
    email: person.email,
    url: siteUrl,
    sameAs: (person.profiles ?? []).map((p: any) => validateUrl(p.url, 'person.profiles[].url')),
  }

  if (education) {
    personNode.alumniOf = {
      '@type': 'CollegeOrUniversity',
      name: education.institution,
      // The sink the controller amendment's six-sink list omitted:
      // person.education.institution_url. Same guarantee as
      // worksFor.url above, for the same reason - an agent reading
      // alumniOf.url deserves a validated scheme too.
      ...(education.institution_url
        ? { url: validateUrl(education.institution_url, 'person.education.institution_url') }
        : {}),
    }
  }

  const websiteNode: Record<string, unknown> = {
    '@type': 'WebSite',
    '@id': websiteId,
    url: siteUrl,
    name: site.title,
    publisher: { '@id': personId },
    about: { '@id': personId },
    // Sourced from the injected `lastUpdated` argument, NEVER the wall
    // clock - the same reproducible-build property renderSitemapXml()'s
    // lastmod already locks in. The default falls back to
    // profile._meta.last_updated (a hand-edited content-model field) so
    // this function stays pure and callable with just `profile`, but the
    // real caller (index.astro) passes resolveLastUpdated()'s git-derived
    // date instead - see src/lib/lastUpdated.ts for why that source beats
    // both the wall clock (breaks reproducible builds) and the hand-edited
    // field alone (silently rots).
    dateModified: lastUpdated,
  }

  return {
    '@context': 'https://schema.org',
    '@graph': [personNode, websiteNode],
  }
}
