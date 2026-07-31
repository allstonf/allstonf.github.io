// tests/resumePdf.test.ts - the resume PDF is a PUBLISHED BINARY, and the
// six-artifact guard in publicArtifactsPii.test.ts cannot see inside it.
// That guard reads each artifact as UTF-8 text; a PDF's text lives in
// compressed streams, so a phone number inside one would sail past it.
//
// This pins the exact bytes instead. The pinned hash was established
// after a pdftotext scan on 2026-07-31 found zero phone matches across
// three patterns, zero street-address matches, no residence city (the
// four location tokens are employer/school columns: Cupertino, San Jose
// x2, San Diego) and clean metadata with no Author field.
//
// If this test fails, the PDF changed. That is not a reason to update the
// hash - it is a reason to re-run the PII scan BEFORE updating the hash:
//   pdftotext -layout public/Allston_Fojas_Resume.pdf - | grep -E '\(?[0-9]{3}\)?[ .-]?[0-9]{3}[.-][0-9]{4}'
// Fails closed: an unreviewed PDF cannot reach a public commit silently.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import profile from '../content/profile.json'

const PDF_PATH = 'public/Allston_Fojas_Resume.pdf'

// Established 2026-07-31 after the PII scan described above.
const REVIEWED_SHA256 =
  'a68a760a9589ce1841bafbcd55ecfacc708a27134c4e43b4ecb3af3464135f77'

describe('the published resume PDF', () => {
  it('is tracked in public/ so Astro copies it to the site root', () => {
    expect(existsSync(PDF_PATH)).toBe(true)
  })

  it('matches the reviewed bytes exactly', () => {
    const actual = createHash('sha256').update(readFileSync(PDF_PATH)).digest('hex')
    expect(actual).toBe(REVIEWED_SHA256)
  })

  it('is what person.resume.url points at, as a same-origin relative path', () => {
    // Relative, not the Drive URL: a link whose target lives outside the
    // repo can change contents without any check in this suite noticing.
    // verify-content.mjs --check-urls only probes https:// matches, so an
    // external resume link is invisible to the URL gate as well.
    expect(profile.person.resume.url).toBe('/Allston_Fojas_Resume.pdf')
  })

  it('is emitted into dist/ by the build', () => {
    // public/ is copied verbatim to the site root. Requires a build first
    // (npm run verify:all), the same precondition agentSurface.test.ts has.
    expect(existsSync('dist/Allston_Fojas_Resume.pdf')).toBe(true)
  })
})
