// tests/validateProfile.test.ts - whole-document content-model invariants
// that no per-value escaping helper can catch, ported from v1's
// build/build.py validate_profile().
//
// Both checks guard a real HTML-injection-adjacent failure mode rather
// than a cosmetic one: (1) a duplicate project slug collides two DOM
// ids (project-<slug> and its -heading partner), breaking the
// aria-labelledby association a screen reader depends on; (2) an email
// shaped like "x&y=z@host" survives HTML-entity escaping intact (the
// browser decodes entities before it parses the mailto: URI), so an
// "&" or "?" in the local part becomes a real mailto parameter
// (&body=, &cc=) on a live public page. Both must fail the BUILD, not
// just fail silently at render time - so validateProfile() throws
// rather than returning a boolean, and index.astro calls it before any
// other processing.
import { describe, expect, it } from 'vitest'
import profile from '../content/profile.json'
import { ProfileValidationError, validateProfile } from '../src/lib/validateProfile'

describe('validateProfile fails closed on content-model invariants', () => {
  it('accepts the real profile unchanged', () => {
    // The baseline: content/profile.json today must already satisfy
    // both invariants, or every other test in this file would be
    // exercising a check that can never actually pass in this repo.
    expect(() => validateProfile(profile as any)).not.toThrow()
  })

  it('rejects a duplicate project slug', () => {
    const dirty = structuredClone(profile) as any
    // Force a real collision: two projects sharing the first project's
    // slug. Each slug becomes id="project-<slug>" plus its -heading
    // partner, so this is the exact shape that would emit invalid HTML.
    dirty.projects[1].slug = dirty.projects[0].slug
    expect(() => validateProfile(dirty)).toThrow(ProfileValidationError)
  })

  it('rejects an email shape that would poison the mailto: URI', () => {
    const dirty = structuredClone(profile) as any
    // "&" survives HTML-entity escaping (the browser decodes entities
    // before parsing the URI), turning into a real mailto parameter -
    // exactly the shape build.py's _EMAIL_PATTERN was added to reject.
    dirty.person.email = 'victim@example.com&body=unwanted'
    expect(() => validateProfile(dirty)).toThrow(ProfileValidationError)
  })

  it('rejects an email with no @ at all', () => {
    const dirty = structuredClone(profile) as any
    dirty.person.email = 'not-an-email'
    expect(() => validateProfile(dirty)).toThrow(ProfileValidationError)
  })
})
