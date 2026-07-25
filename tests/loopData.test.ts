// tests/loopData.test.ts - the publish gate for content/loop-data.json.
//
// content/loop-data.json is a hand-authored, public-safe extract of a
// private rubric-change log that contains a named recruiter, salary
// figures, employer names tied to rejection outcomes, and internal req
// IDs. None of that may ever reach this public repo. This test is the
// gate that runs before every commit touching the file - it is
// deliberately blunt (a banned-word list plus two numeric-shape checks)
// rather than clever, because a gate that is easy to reason about is a
// gate that is hard to accidentally defeat.
//
// A code-reviewer pass on this file found two real gameability bugs in
// the original digit/dollar regexes (ordinary formatting like a comma
// inside a number, or a space after "$", made both checks evadable) and
// a documentation gap on the banned-name list (it is a fixed enumeration
// with no mechanism forcing it to grow, so an unlisted company name would
// silently pass). The regex bug is fixed below with a normalization pass.
// The banned-name-list limitation is inherent to a literal-string
// denylist - the loud comment beneath BANNED_NAMES exists so that
// limitation is never mistaken for automatic detection.
import { describe, it, expect } from 'vitest'
import loop from '../content/loop-data.json'

// UPDATE THIS LIST whenever loop-data.json is edited to reference a new
// company, recruiter, or other named party. This is a literal-string
// denylist, not a detector - it catches exactly the names it is told
// about and nothing else. It cannot recognize an unlisted proper noun
// (e.g. a new employer added to a future retrospective) on its own; the
// synthetic-fixture tests below prove the check DOES work once a name is
// added to this list, not that it works for names that are not.
const BANNED_NAMES = [
  'NVIDIA', 'Google', 'Apple', 'Sierra', 'Broadcom', 'Samsung', 'Twitch',
  'Databricks', 'OpenAI', 'Anthropic', 'Etched', 'Solutus', 'Ashley',
]

/**
 * The exact publish-gate logic, extracted so it can run against both the
 * real committed data and synthetic hostile fixtures in tests below - a
 * gate only ever exercised against the clean data it protects would never
 * catch its own blind spots.
 *
 * Digits are normalized (commas, whitespace, and dashes stripped) before
 * the shape checks run, because none of those characters change what a
 * number IS: "135,000" and "135000" are the same figure, "JR-201-6997"
 * and "JR2016997" are the same req ID. Testing the raw, unnormalized text
 * is what let "$  135,000" and a dashed req ID sail through undetected.
 */
function findPublishLeaks(raw: string): string[] {
  const leaks: string[] = []
  for (const banned of BANNED_NAMES) {
    if (raw.includes(banned)) leaks.push(`banned name: ${banned}`)
  }
  const normalized = raw.replace(/[,\s-]/g, '')
  if (/\d{6,}/.test(normalized)) leaks.push('6+ digit run (req ID shape)')
  if (/\$\d/.test(normalized)) leaks.push('dollar-prefixed figure')
  return leaks
}

describe('loop-data.json is publishable', () => {
  const raw = JSON.stringify(loop)

  it('contains no company names, recruiter names, or req IDs', () => {
    expect(findPublishLeaks(raw)).toEqual([])
  })

  it('asserts the centerpiece: no weight was ever mutated', () => {
    expect(loop.changes.length).toBeGreaterThanOrEqual(9)
    expect(loop.changes.every(c => c.weightsMutated === false)).toBe(true)
  })

  it('weights sum to 100', () => {
    expect(loop.weights.reduce((s, w) => s + w.weight, 0)).toBe(100)
  })
})

describe('findPublishLeaks catches formatting a naive regex would miss', () => {
  // Regression tests for the two concrete failing inputs a code-reviewer
  // pass found: a dollar figure with unusual spacing, and a req ID split
  // by dashes. Both previously evaded the unnormalized regexes while
  // still being exactly the sensitive data the gate exists to catch.
  it('catches a dollar figure with extra whitespace and a comma-split number', () => {
    const hostile = JSON.stringify({ summary: 'Comp was below $  135,000 floor.' })
    expect(findPublishLeaks(hostile)).toEqual(
      expect.arrayContaining(['6+ digit run (req ID shape)', 'dollar-prefixed figure']),
    )
  })

  it('catches a dashed req ID', () => {
    const hostile = JSON.stringify({ reqId: 'JR-201-6997' })
    expect(findPublishLeaks(hostile)).toEqual(
      expect.arrayContaining(['6+ digit run (req ID shape)']),
    )
  })

  it('catches a banned name once it is added to the list - proving the list is not decorative', () => {
    const hostile = JSON.stringify({ summary: 'Apple passed on this role.' })
    expect(findPublishLeaks(hostile)).toEqual(
      expect.arrayContaining(['banned name: Apple']),
    )
  })
})
