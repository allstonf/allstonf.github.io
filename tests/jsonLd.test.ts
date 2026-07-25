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
import { describe, it, expect } from 'vitest'
import { buildJsonLd } from '../src/lib/jsonLd'
import { UnpublishableUrlError } from '../src/lib/url'
import profile from '../content/profile.json'

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
    expect(jsonLd.worksFor.name).toBe('Apple')
    expect(jsonLd.alumniOf.url).toBe(profile.person.education.institution_url)
  })
})
