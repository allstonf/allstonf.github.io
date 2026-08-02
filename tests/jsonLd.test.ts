// tests/jsonLd.test.ts - the schema.org Person object embedded in
// index.astro's <script type="application/ld+json"> block.
//
// Fix round 1, Finding 2: the JSON-LD object was built inline in
// index.astro's frontmatter, which is not importable by vitest - so a
// missing validateUrl() call on person.education.institution_url went
// undetected until an adversarial review caught it by hand
// (javascript:alert(1) reached dist/index.html's JSON-LD block
// verbatim, build exit 0). Extracting the construction into
// src/lib/jsonLd.ts's buildJsonLd() makes that URL sink testable the
// same way tests/publicProjection.test.ts already tests the others:
// inject a hostile value into a structuredClone of the real profile
// and assert the build throws.
import { describe, expect, it } from 'vitest'
import profile from '../content/profile.json'
import { buildJsonLd } from '../src/lib/jsonLd'
import { UnpublishableUrlError } from '../src/lib/url'

describe('buildJsonLd fails closed on every URL sink it emits', () => {
  it('rejects a disallowed scheme in person.education.institution_url', () => {
    const dirty = structuredClone(profile) as any
    dirty.person.education.institution_url = 'javascript:alert(1)'
    expect(() => buildJsonLd(dirty)).toThrow(UnpublishableUrlError)
  })

  it('rejects a disallowed scheme in person.current_role.employer_url', () => {
    const dirty = structuredClone(profile) as any
    dirty.person.current_role.employer_url = 'javascript:alert(1)'
    expect(() => buildJsonLd(dirty)).toThrow(UnpublishableUrlError)
  })

  it('rejects a disallowed scheme in site.url', () => {
    const dirty = structuredClone(profile) as any
    dirty.site.url = 'javascript:alert(1)'
    expect(() => buildJsonLd(dirty)).toThrow(UnpublishableUrlError)
  })

  it('builds cleanly for the real profile and names Apple as worksFor', () => {
    const jsonLd = buildJsonLd(profile) as any
    const personNode = jsonLd['@graph'].find((node: any) => node['@type'] === 'Person')
    expect(personNode.worksFor.name).toBe('Apple')
    expect(personNode.alumniOf.url).toBe(profile.person.education.institution_url)
  })
})

// Task 6: entity-disambiguation hardening. A bare Person object with no
// stable identifier and no linked WebSite is exactly what makes an
// agent's cross-page/cross-mention entity resolution ambiguous - two
// "Allston Fojas" mentions on the web have nothing forcing them to
// resolve to the SAME node. @id + a WebSite node that references the
// Person back via publisher/about gives a crawler an anchor to dedupe
// against, per schema.org's documented @graph/@id pattern for tying
// multiple entities on one page together.
describe('buildJsonLd emits a disambiguation-hardened @graph', () => {
  it('gives the Person node a stable @id at <site.url>/#person', () => {
    const jsonLd = buildJsonLd(profile) as any
    const personNode = jsonLd['@graph'].find((node: any) => node['@type'] === 'Person')
    expect(personNode).toBeDefined()
    expect(personNode['@id']).toBe(`${profile.site.url}/#person`)
  })

  it('emits a WebSite node with its own @id that references the Person via publisher and about', () => {
    const jsonLd = buildJsonLd(profile) as any
    const websiteNode = jsonLd['@graph'].find((node: any) => node['@type'] === 'WebSite')
    expect(websiteNode).toBeDefined()
    expect(websiteNode['@id']).toBe(`${profile.site.url}/#website`)
    expect(websiteNode.url).toBe(profile.site.url)
    expect(websiteNode.name).toBe(profile.site.title)
    expect(websiteNode.publisher).toEqual({ '@id': `${profile.site.url}/#person` })
    expect(websiteNode.about).toEqual({ '@id': `${profile.site.url}/#person` })
  })

  it('sources dateModified from the injected lastUpdated argument, never the wall clock', () => {
    // Task: freshness-signal fix (2026-08-01). dateModified used to read
    // straight from _meta.last_updated (a hand-edited field measured 7
    // days stale against the live republish date). buildJsonLd() now
    // takes an OPTIONAL second `lastUpdated` argument - the caller
    // (index.astro) resolves it via resolveLastUpdated() (git commit date
    // of HEAD, src/lib/lastUpdated.ts) and passes it in, keeping this
    // renderer itself pure and still directly testable. Asserting an
    // EXPLICITLY INJECTED value here, rather than the profile's default,
    // is what proves the wall clock (or any other undocumented source)
    // cannot leak in - dateModified only ever changes via this argument.
    const jsonLd = buildJsonLd(profile, '2026-08-01') as any
    const websiteNode = jsonLd['@graph'].find((node: any) => node['@type'] === 'WebSite')
    expect(websiteNode.dateModified).toBe('2026-08-01')
  })

  it('defaults dateModified to _meta.last_updated when no lastUpdated argument is given', () => {
    // Keeps buildJsonLd(profile) - the call shape every OTHER test in this
    // file already uses - meaningful without threading a second argument
    // through them all.
    const jsonLd = buildJsonLd(profile) as any
    const websiteNode = jsonLd['@graph'].find((node: any) => node['@type'] === 'WebSite')
    expect(websiteNode.dateModified).toBe(profile._meta.last_updated)
  })

  it('still keeps sameAs populated from person.profiles, validated through validateUrl', () => {
    const jsonLd = buildJsonLd(profile) as any
    const personNode = jsonLd['@graph'].find((node: any) => node['@type'] === 'Person')
    expect(personNode.sameAs).toEqual(profile.person.profiles.map((p) => p.url))
  })

  it('rejects a disallowed scheme in site.url before either node is built', () => {
    const dirty = structuredClone(profile) as any
    dirty.site.url = 'javascript:alert(1)'
    expect(() => buildJsonLd(dirty)).toThrow(UnpublishableUrlError)
  })
})
