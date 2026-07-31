// tests/resumeUrlAbsolute.test.ts - the resume URL must be ABSOLUTE in every
// machine-consumed surface, even though the content model stores it as a
// same-origin relative path.
//
// Why this is not pedantry. dist/api/profile.json and dist/llms.txt are fetched
// DIRECTLY by agents and tools over raw HTTP, not loaded as documents a browser
// resolves relative links against. Neither carries a site/origin field a
// consumer could join a relative path to: api/profile.json's top-level keys are
// exactly person, about, projects, experience. So a bare "/Allston_Fojas_Resume.pdf"
// is unresolvable to the very readers those surfaces exist for, and every OTHER
// url in the same document (employer_url, institution_url, both profiles[].url)
// is absolute - the resume was the lone exception.
//
// This was a REGRESSION introduced when the resume moved from an absolute Google
// Drive URL to a repo-served PDF. The relative form was chosen so that
// verify-content's --check-urls probe would skip it (it only matches https://),
// which is correct for a file that cannot be fetched before it is deployed - but
// that reasoning was about the BUILD, and it silently changed the semantics of a
// published machine surface. Caught in review, not by the suite.
//
// The human page deliberately keeps the RELATIVE href: a browser resolves it
// against the document, and a same-origin relative link is the correct form
// there. This test does not touch index.html.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import profile from '../content/profile.json'
import { renderLlmsTxt } from '../src/lib/agentSurface'

const SITE = profile.site.url.replace(/\/+$/, '')
const EXPECTED = `${SITE}/Allston_Fojas_Resume.pdf`

describe('the resume URL is absolute wherever a machine reads it', () => {
  it('content/profile.json still stores the relative path as the single source', () => {
    // The model keeps ONE canonical same-origin value. Absolutizing happens at
    // render, so the site origin lives in exactly one place (site.url).
    expect(profile.person.resume.url).toBe('/Allston_Fojas_Resume.pdf')
  })

  it('renderLlmsTxt emits it absolute', () => {
    expect(renderLlmsTxt(profile)).toContain(EXPECTED)
  })

  it('dist/llms.txt carries no bare relative resume link', () => {
    // Requires a build (npm run verify:all), same precondition as
    // agentSurface.test.ts and parity.test.ts.
    expect(existsSync('dist/llms.txt')).toBe(true)
    const txt = readFileSync('dist/llms.txt', 'utf8')
    expect(txt).toContain(EXPECTED)
    expect(txt).not.toMatch(/\]\(\/Allston_Fojas_Resume\.pdf\)/)
  })

  it('dist/api/profile.json emits it absolute', () => {
    expect(existsSync('dist/api/profile.json')).toBe(true)
    const api = JSON.parse(readFileSync('dist/api/profile.json', 'utf8'))
    expect(api.person.resume.url).toBe(EXPECTED)
  })

  it('dist/api/profile.json contains NO relative url of any kind', () => {
    // The general invariant behind this fix: a document with no origin field
    // cannot carry a relative url that anyone can resolve. Guards the whole
    // class, so a future field cannot reintroduce the same defect elsewhere.
    const api = JSON.parse(readFileSync('dist/api/profile.json', 'utf8'))
    const relatives: string[] = []
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'string') {
        if (path.endsWith('url') && node.startsWith('/')) relatives.push(`${path}=${node}`)
      } else if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, `${path}[${i}]`))
      } else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k)
      }
    }
    walk(api, '')
    expect(relatives).toEqual([])
  })
})
