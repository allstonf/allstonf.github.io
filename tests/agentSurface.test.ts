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

const CANARY = 'CANARY-INTERNAL-DO-NOT-PUBLISH'

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

  it('api/profile.json exists, parses, and contains no canary', () => {
    expect(existsSync('dist/api/profile.json')).toBe(true)
    const text = readFileSync('dist/api/profile.json', 'utf8')
    const parsed = JSON.parse(text)
    expect(parsed.person.current_role.employer).toBe('Apple')
    expect(text).not.toContain(CANARY)
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
