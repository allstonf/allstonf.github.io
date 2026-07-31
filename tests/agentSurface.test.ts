// tests/agentSurface.test.ts - the five agent-surface endpoints.
//
// Reads real build output under dist/, the same pattern parity.test.ts
// already uses for index.html: run `npx astro build` before running
// this suite, since these endpoints are static-prerendered files under
// Astro's default "static" output mode, not something vitest renders
// itself.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import profile from '../content/profile.json'
import { PUBLIC_PERSON_FIELDS, PUBLIC_PROJECT_FIELDS } from '../src/lib/publicProjection'

describe('agent surface endpoints build to real files under dist/', () => {
  it('llms.txt follows the llmstxt.org spec: H1 name, blockquote summary, one Docs entry, an Optional section', () => {
    // Task 6 rewrite: llms.txt used to carry the free-text
    // agent_surface.llms_txt_guidance paragraph, which is NOT part of
    // the llmstxt.org spec (llmstxt.org defines only an H1, an optional
    // blockquote, and ##-sectioned link lists). This test locks in the
    // spec-compliant shape instead.
    expect(existsSync('dist/llms.txt')).toBe(true)
    const text = readFileSync('dist/llms.txt', 'utf8')
    const lines = text.split('\n')

    // H1 is the ONLY required section per llmstxt.org, and it must be
    // the person's name read from the content model, not marketing copy.
    expect(lines[0]).toBe(`# ${profile.person.name}`)

    // The blockquote directly under the H1 is a plain third-person
    // "[Name] is a [role], at [organization], focused on ..." sentence
    // - third person even though the site body is first person, because
    // llms.txt is machine-facing. Exact-match, not toContain, so a
    // future edit that quietly drops a clause (or reintroduces the
    // missing-article grammar bug from fix round 1) still fails loudly.
    // The title itself ("Systems Software Engineer, Power and
    // Performance") carries an internal comma, so it is bracketed by
    // commas on both sides rather than glued directly to "at".
    const focusAreas = profile.person.knows_about.slice(0, 2).join(' and ')
    const expectedBlockquote =
      `> ${profile.person.name} is a ${profile.person.current_role.title}, at ` +
      `${profile.person.current_role.employer}, focused on ${focusAreas}.`
    expect(lines[2]).toBe(expectedBlockquote)

    // ## Docs contains EXACTLY one entry per DISTINCT fetchable markdown
    // resource: the page mirror at /index.md, and (Task 5) the resume at
    // /resume.md. Still an exact count, not a lower bound - separate
    // About/Projects/Experience anchor entries into the same single page
    // would pad the file without adding structure, and that is the
    // regression this length assertion exists to catch.
    const docsStart = text.indexOf('## Docs')
    const optionalStart = text.indexOf('## Optional')
    expect(docsStart).toBeGreaterThan(-1)
    expect(optionalStart).toBeGreaterThan(docsStart)
    const docsEntries = text
      .slice(docsStart, optionalStart)
      .split('\n')
      .filter((line) => line.startsWith('- ['))
    expect(docsEntries).toHaveLength(2)
    expect(docsEntries[0]).toContain(`${profile.site.url}/index.md`)
    expect(docsEntries[1]).toContain(`${profile.site.url}/resume.md`)

    // ## Optional carries GitHub + LinkedIn, per spec semantics ("can
    // be skipped if a shorter context is needed"). Fix round 1: no
    // trailing ": handle" description, since repeating the handle after
    // a link whose text is already the profile label added nothing.
    const optionalEntries = text
      .slice(optionalStart)
      .split('\n')
      .filter((line) => line.startsWith('- ['))
    expect(optionalEntries).toContain('- [GitHub](https://github.com/allstoncodes)')
    expect(optionalEntries).toContain('- [LinkedIn](https://www.linkedin.com/in/allston-fojas)')

    // The retired, empty GitHub handle must never resurface - it is
    // the exact broken link this rebuild fixed.
    expect(text).not.toContain('github.com/allstonf')
  })

  it('carries the stale-employer disambiguation paragraph naming both employers and the current GitHub handle', () => {
    // Fix round 1: this paragraph was dropped in the first pass because
    // it is not part of the llmstxt.org spec's REQUIRED sections - but
    // the spec explicitly allows free-prose sections between the
    // blockquote and the first "##" heading, and this paragraph is the
    // deliberate mechanism that resolves a stale "still at Cisco"
    // answer for an agent whose training data or a cached copy of the
    // pre-rebuild site disagrees with the current content model. A
    // positive assertion ("is at Apple") does not itself contradict a
    // stale claim the way an explicit correction does.
    expect(existsSync('dist/llms.txt')).toBe(true)
    const text = readFileSync('dist/llms.txt', 'utf8')

    const currentEmployer = profile.person.current_role.employer
    const priorEmployer = profile.experience.find((job) => job.employer !== currentEmployer)!.employer
    const currentGithubHandle = profile.person.profiles.find((p) => p.label === 'GitHub')!.handle

    expect(text).toContain(currentEmployer)
    expect(text).toContain(priorEmployer)
    expect(text).toContain(currentGithubHandle)

    // The guidance sentence itself must be present verbatim, not just
    // an incidental employer mention elsewhere in the file (the
    // blockquote already names the current employer on its own) - this
    // is what a future refactor could silently drop again.
    expect(text).toContain(profile.agent_surface.llms_txt_guidance)
  })

  it('api/profile.json exists, parses, and matches the allowlisted shape exactly', () => {
    // Fix round 1: the prior version of this test asserted the ABSENCE
    // of a canary string that content/profile.json never contains, so
    // it could never fail no matter what the endpoint served - proven
    // by review: swapping src/pages/api/profile.json.ts to a raw
    // profile passthrough (the exact v1 leak class) still passed 5/5.
    // This version asserts the actual shape of the real build output
    // against the same allowlists src/lib/publicProjection.ts is built
    // from, so a wiring regression that serves an un-projected object
    // changes this assertion and the test fails.
    expect(existsSync('dist/api/profile.json')).toBe(true)
    const text = readFileSync('dist/api/profile.json', 'utf8')
    const parsed = JSON.parse(text)

    expect(Object.keys(parsed).sort()).toEqual(['about', 'experience', 'person', 'projects'])

    // One level down, cheaply: every key actually present on the built
    // person object must be one of the allowlisted person fields (e.g.
    // catches a stray "internal_todo" or an un-projected "resume.note"
    // riding along on the raw source object).
    for (const key of Object.keys(parsed.person)) {
      expect(PUBLIC_PERSON_FIELDS).toContain(key)
    }
    for (const project of parsed.projects) {
      for (const key of Object.keys(project)) {
        expect(PUBLIC_PROJECT_FIELDS).toContain(key)
      }
    }

    expect(parsed.person.current_role.employer).toBe('Apple')
  })

  it('sitemap.xml exists and is well-formed XML', () => {
    expect(existsSync('dist/sitemap.xml')).toBe(true)
    const xml = readFileSync('dist/sitemap.xml', 'utf8')
    // No XML parser is a project dependency (keeps the zero-supply-chain
    // build tooling budget v1 established), so well-formedness is
    // asserted structurally: a declaration, one root <urlset>, and a
    // matched open/close tag count for every <url> entry.
    expect(xml.trim().startsWith('<?xml')).toBe(true)
    expect(xml).toMatch(/<urlset[^>]*>[\s\S]*<\/urlset>/)
    const opens = xml.match(/<url>/g) ?? []
    const closes = xml.match(/<\/url>/g) ?? []
    expect(opens.length).toBeGreaterThan(0)
    expect(opens.length).toBe(closes.length)
  })

  it('robots.txt exists and names every agent crawler with Allow: /', () => {
    expect(existsSync('dist/robots.txt')).toBe(true)
    const text = readFileSync('dist/robots.txt', 'utf8')
    for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
      const botBlock = new RegExp(`User-agent: ${bot}\\nAllow: /`)
      expect(text).toMatch(botBlock)
    }
  })

  it('robots.txt points at both llms.txt and llms-full.txt via a plain comment, not a directive', () => {
    // Informal practice, not spec - a "#" comment line, never a
    // Disallow/Allow directive, since llms.txt/llms-full.txt are not
    // robots.txt concepts.
    const text = readFileSync('dist/robots.txt', 'utf8')
    expect(text).toContain(`# Agent-readable profile: ${profile.site.url}/llms.txt`)
    expect(text).toContain(`# Full-content agent surface: ${profile.site.url}/llms-full.txt`)
  })

  it('index.md exists and contains the about text', () => {
    expect(existsSync('dist/index.md')).toBe(true)
    const text = readFileSync('dist/index.md', 'utf8')
    for (const paragraph of profile.about) {
      expect(text).toContain(paragraph.slice(0, 40))
    }
  })

  it('index.md contains the education institution, read from the content model', () => {
    // Regression guard for the exact bug class this whole rebuild
    // exists to eliminate. index.astro's header <dd> renders
    // person.education as VISIBLE text (see the matching test in
    // tests/parity.test.ts), but renderIndexMd() never read
    // person.education at all - and since llms-full.txt is
    // mechanically derived from renderIndexMd() (see the "mechanically
    // derived" describe block below), both machine-readable surfaces
    // silently omitted education while the human page had it. Confirmed
    // live pre-fix via `curl http://127.0.0.1:8908/index.md`, which
    // showed role/tagline/About/Projects/Experience with no education.
    expect(existsSync('dist/index.md')).toBe(true)
    const text = readFileSync('dist/index.md', 'utf8')
    expect(text).toContain(profile.person.education.institution)
  })
})

describe('llms-full.txt is mechanically derived from index.md, never hand-authored', () => {
  it('exists, carries a generated-file warning, and starts with the same H1/blockquote/disambiguation header as llms.txt', () => {
    expect(existsSync('dist/llms-full.txt')).toBe(true)
    const text = readFileSync('dist/llms-full.txt', 'utf8')

    expect(text.toLowerCase()).toContain('generated')
    expect(text.toLowerCase()).toContain('do not hand-edit')
    expect(text).toContain(`# ${profile.person.name}`)

    const focusAreas = profile.person.knows_about.slice(0, 2).join(' and ')
    const expectedBlockquote =
      `> ${profile.person.name} is a ${profile.person.current_role.title}, at ` +
      `${profile.person.current_role.employer}, focused on ${focusAreas}.`
    expect(text).toContain(expectedBlockquote)

    // The full-text surface carries the same disambiguation paragraph
    // as llms.txt - this is the "full" agent surface, so it should be
    // at least as self-correcting as the lean index, not less.
    expect(text).toContain(profile.agent_surface.llms_txt_guidance)
  })

  it('contains the exact same body text as dist/index.md, so the two files cannot silently diverge', () => {
    // The load-bearing guarantee: llms-full.txt is built by reusing
    // renderIndexMd() (the same function that produces index.md)
    // rather than a hand-maintained second copy of the page content.
    // Asserting containment of the REAL built index.md output (not a
    // hardcoded snapshot) means a future edit that swaps this back to
    // a separately hand-authored string fails this test immediately.
    const full = readFileSync('dist/llms-full.txt', 'utf8')
    const indexMd = readFileSync('dist/index.md', 'utf8')
    expect(full).toContain(indexMd)
  })
})
