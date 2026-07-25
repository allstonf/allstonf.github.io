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
  it('llms.txt exists and contains the Apple current-role guidance sentence', () => {
    expect(existsSync('dist/llms.txt')).toBe(true)
    const text = readFileSync('dist/llms.txt', 'utf8')
    // agent_surface.llms_txt_guidance is the exact sentence the content
    // model authors to correct a stale "still at Cisco" answer - it is
    // the load-bearing copy this endpoint exists to serve.
    expect(text).toContain(profile.agent_surface.llms_txt_guidance)
    expect(text).toContain('Apple')
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

  it('index.md exists and contains the about text', () => {
    expect(existsSync('dist/index.md')).toBe(true)
    const text = readFileSync('dist/index.md', 'utf8')
    for (const paragraph of profile.about) {
      expect(text).toContain(paragraph.slice(0, 40))
    }
  })
})
