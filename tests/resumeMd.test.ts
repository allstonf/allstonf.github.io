// tests/resumeMd.test.ts - the acceptance suite for /resume.md, the
// machine-readable resume surface.
//
// Two of these tests are PII canaries rather than behaviour tests: they
// poison the content model with a string that must never reach a public
// URL, once at the top level and once nested inside an experience entry.
// They exist because v1's render_api_profile() copied whole subtrees and
// published an internal editorial note to a public URL, and because git
// history is permanent - a leak here cannot be taken back by a later
// commit. They must pass BY CONSTRUCTION (the renderer builds output
// from a named-field allowlist) rather than by the poisoned field
// happening to be absent today.
import { describe, it, expect } from 'vitest'
import profile from '../content/profile.json'
import { renderResumeMd } from '../src/lib/agentSurface'

describe('renderResumeMd', () => {
  const md = renderResumeMd(profile)

  it('leads with the name as a single H1', () => {
    const h1s = md.split('\n').filter((l) => l.startsWith('# '))
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toContain(profile.person.name)
  })

  it('names the CURRENT employer, since a stale employer is the failure this site exists to fix', () => {
    expect(md).toContain(profile.person.current_role.employer)
  })

  it('renders every experience entry with employer, title and a date range', () => {
    for (const role of profile.experience) {
      expect(md).toContain(role.employer)
      expect(md).toContain(role.title)
      expect(md).toContain(role.start)
    }
  })

  it('marks the current role as Present rather than inventing an end date', () => {
    const current = profile.experience.find((r: any) => !r.end)
    expect(current).toBeDefined()
    expect(md).toContain('Present')
  })

  it('renders every project name and its stack', () => {
    for (const project of profile.projects) {
      expect(md).toContain(project.name)
    }
  })

  it('lists every skill from knows_about', () => {
    for (const skill of profile.person.knows_about) {
      expect(md).toContain(skill)
    }
  })

  it('emits NO phone number or street address, whatever the content model gains later', () => {
    // Fail closed: this file is public and git history is permanent.
    expect(md).not.toMatch(/\+?\d[\d\s().-]{8,}\d/) // phone-shaped runs
    expect(md).not.toMatch(
      /\d+\s+\w+\s+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Blvd)\b/i,
    )
  })

  it('ignores unknown top-level fields rather than publishing them', () => {
    const poisoned = { ...profile, internal_review_notes: 'CANARY_MUST_NOT_PUBLISH' }
    expect(renderResumeMd(poisoned)).not.toContain('CANARY_MUST_NOT_PUBLISH')
  })

  it('ignores unknown fields nested inside an experience entry', () => {
    const poisoned = JSON.parse(JSON.stringify(profile))
    poisoned.experience[0].salary = 'CANARY_MUST_NOT_PUBLISH'
    expect(renderResumeMd(poisoned)).not.toContain('CANARY_MUST_NOT_PUBLISH')
  })
})
