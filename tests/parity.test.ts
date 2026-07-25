import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
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
})
