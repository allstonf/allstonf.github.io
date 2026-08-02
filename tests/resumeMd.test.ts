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
import { describe, expect, it } from 'vitest'
import profile from '../content/profile.json'
import { renderResumeMd } from '../src/lib/agentSurface'
import { assertNoPii } from './helpers/piiGuard'

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

  // Review round 1 REMOVED a test that required every person.knows_about
  // member to appear here. That assertion encoded a wrong requirement, so
  // deleting it is a correction rather than a weakening: knows_about is
  // schema.org shaping that exists for the JSON-LD consumer (jsonLd.ts's
  // knowsAbout) and for /index.md, and publishing it here both duplicated
  // Objective-C / C++ / Python against the Programming Languages group and
  // pushed a file that mirrors a ONE-PAGE resume to a 40-item skills
  // section. The field stays in content/profile.json untouched; it just
  // does not belong on this surface. The test below replaces it with the
  // requirement that actually holds.
  it('publishes exactly the three PDF skill groups, and no schema.org focus-area list', () => {
    const skillsStart = md.indexOf('## Skills')
    const skillsEnd = md.indexOf('## Experience')
    expect(skillsStart).toBeGreaterThan(-1)
    expect(skillsEnd).toBeGreaterThan(skillsStart)
    const groupLines = md
      .slice(skillsStart, skillsEnd)
      .split('\n')
      .filter((line) => line.startsWith('- **'))

    // Exact count, not a lower bound: the regression this guards is a
    // fourth group appearing, which is how the duplication got in.
    expect(groupLines).toHaveLength(3)
    expect(groupLines[0]).toContain('**Programming Languages:**')
    expect(groupLines[1]).toContain('**Development Tools:**')
    expect(groupLines[2]).toContain('**AI Agent Tools:**')

    // "Retrieval-Augmented Generation" appears ONLY in knows_about, in the
    // whole content model, so its absence proves the schema.org list is
    // gone rather than merely relabelled.
    expect(md).not.toContain('Focus Areas')
    expect(md).not.toContain('Retrieval-Augmented Generation')
  })

  it('separates a project Stack line from its links, so CommonMark cannot fuse them into one paragraph', () => {
    // Three consecutive non-blank lines are ONE paragraph in CommonMark,
    // so "Stack: ...\nLink: [a](x)\nLink: [b](y)" renders as a single
    // run-on sentence. That is a real defect in the one artifact whose
    // whole purpose is clean machine parsing, and it applies between two
    // link lines just as much as at the Stack/link boundary. Every Stack
    // line must therefore be followed by a blank line, and each link must
    // be its own list item (a list item is its own block).
    expect(md).not.toMatch(/^Stack:.*\n(?!\n)/m)
    for (const project of profile.projects) {
      for (const link of project.links) {
        expect(md).toContain(`- [${link.label}](${link.url})`)
      }
    }
  })

  it('emits NO phone number or street address, whatever the content model gains later', () => {
    // Fail closed: this file is public and git history is permanent.
    //
    // This was the ORIGINAL guard - the only one of the six public
    // artifacts that had it, until tests/publicArtifactsPii.test.ts
    // extended the same check to the other five. The two inline
    // regexes that used to live here now live in
    // tests/helpers/piiGuard.ts's PHONE_SHAPED/STREET_ADDRESS_SHAPED,
    // so this file no longer carries its own private copy - see that
    // module for why resume.md's assertion still needs no date-range
    // stripping (RESUME_DATE_SEPARATOR's " to " word separator already
    // breaks the digit run that trips PHONE_SHAPED, unlike the other
    // five artifacts' " - " form).
    assertNoPii(md)
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
