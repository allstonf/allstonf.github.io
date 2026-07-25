// src/lib/jsonLd.ts - builds the schema.org Person object embedded in
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
import { validateUrl } from './url'

export function buildJsonLd(profile: any): Record<string, unknown> {
  const { person, site } = profile
  const currentRole = person.current_role
  const education = person.education

  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
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
    url: validateUrl(site.url, 'site.url'),
    sameAs: (person.profiles ?? []).map((p: any) => validateUrl(p.url, 'person.profiles[].url')),
  }

  if (education) {
    data.alumniOf = {
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

  return data
}
