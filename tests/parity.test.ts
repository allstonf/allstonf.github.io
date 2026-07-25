import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import profile from '../content/profile.json'

describe('static shell parity with v1', () => {
  const html = readFileSync('dist/index.html', 'utf8')

  it('names Apple as the current employer in VISIBLE text', () => {
    // JSON-LD alone provably fails; the visible line is the load-bearing fix.
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, '')
    expect(visible).toContain(profile.person.current_role.employer)
  })

  it('renders every about paragraph', () => {
    for (const para of profile.about) {
      expect(html).toContain(para.slice(0, 40))
    }
  })

  it('renders every project name', () => {
    for (const p of profile.projects) {
      expect(html).toContain(p.name)
    }
  })

  it('ships no em-dash', () => {
    // Built from its char code (U+2014 = 8212) rather than typed as a
    // literal character, so this test file itself contains zero
    // em-dash bytes, per the standing "no em-dashes anywhere - code,
    // comments, copy, commit messages" style rule. Identical runtime
    // behavior to the literal character.
    expect(html).not.toContain(String.fromCharCode(8212))
  })

  it('ships a favicon that actually resolves on disk', () => {
    // v1's index.html carries <link rel="icon" ...>. A regression here
    // was caught by review round 1: the <link> tag alone is not enough
    // to assert, because a tag pointing at a file the build never
    // copied is exactly the failure mode that shipped - the browser
    // tab silently falls back to the generic icon with no build error.
    // So this test checks BOTH halves: the tag exists, AND the file it
    // points at exists under dist/ after a real build.
    const match = html.match(/<link\s+rel="icon"[^>]*href="([^"]+)"/)
    expect(match, 'expected a <link rel="icon" ...> tag in dist/index.html').not.toBeNull()

    const href = match![1]
    // href is root-relative ("/favicon.svg") because this is a user
    // site served from the domain root (base: '/'), so it maps
    // directly onto a path under dist/ with the leading slash dropped.
    const distPath = join('dist', href.replace(/^\//, ''))
    expect(existsSync(distPath), `expected ${distPath} to exist after astro build`).toBe(true)
  })
})
