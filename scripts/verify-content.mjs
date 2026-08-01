// scripts/verify-content.mjs - the content gate, as code.
//
// Every rule below was previously a line in a markdown checklist that a
// future session could skip, half-run, or read past. Encoding them as a
// pure function with a non-zero exit code makes the gate deterministic:
// the same content model produces the same verdict in any session,
// without anyone having to remember the rules or find the document.
//
// checkContent() is deliberately PURE - no fs, no network - so it is
// unit-testable and so the same rules run identically under vitest and
// at the CLI. URL liveness is the one genuinely non-deterministic check
// and lives behind an explicit --check-urls flag rather than being
// folded in, because a network blip is not a content defect.
import { readFileSync } from 'node:fs'

// Same shape as PHONE_SHAPED in tests/helpers/piiGuard.ts. Duplicated
// deliberately rather than imported: a script under scripts/ must not
// depend on tests/, and catching a bad period HERE - at authoring time -
// beats catching it later in the artifact suite, where the failure
// surfaces as a mysterious PII violation rather than as "your date
// format is wrong".
const PHONE_SHAPED = /\+?\d[\d\s().-]{8,}\d/

// Claims verified FALSE against the actual repo on 2026-07-24 and
// 2026-07-28. Both shipped on a resume at some point. The gate exists so
// they cannot come back by copy-paste from an old draft.
const BANNED_CLAIMS = ['LangChain', 'Perplexity API', 'Perplexity APIs']

// Claims RETRACTED after review, as distinct from BANNED_CLAIMS above
// (which were never true). Each of these shipped in a draft, was
// corrected on a specific date, and must not return by copy-paste.
//
// Full sentences, not keywords: the shorter the needle the more likely
// it fails the build on correct content. "ranked" alone is legitimate -
// the housing system genuinely ranks listings - so the needle is the
// specific CLAIM, not the verb.
const RETRACTED_CLAIMS = [
  // 2026-08-01: the leased property was NOT the top-ranked candidate.
  'the property it ranked first',
  'the top-ranked property',
  'the property the system ranked first',
  // 2026-07-31: the original claim was false because it was UNIVERSAL -
  // only the journal query path is guarded local-only, the broader
  // orchestration calls out to cloud models. A substring gate cannot
  // express "universality", so the needle is the FULL withdrawn clause,
  // not the shorter "I keep the inference local" fragment: that fragment
  // also matches an accurate, narrowly-scoped rewrite of the same fact
  // (see the covering test), which would block a correct future
  // description instead of only a re-paste of the withdrawn sentence.
  // This needle therefore guards against RE-PASTE of the retracted
  // wording, not against RE-ASSERTION of the underlying fact in
  // accurate, scoped language.
  'Where the data is personal, I keep the inference local',
]

// Scoped to waypoint ON PURPOSE, not applied globally.
//
// waypoint-manifest.butterbase.dev returns 200 but serves a static
// landing page, not the running agent, and its repo is private - so
// calling it a demo overstates it to anyone who clicks through. But
// research-vault-showcase genuinely ships a live page and its link is
// accurately labeled "Live". A global label ban would fail the build on
// correct content, which is why the usual "an over-eager match is the
// safe direction" reasoning does NOT apply here: the risk being guarded
// is one specific overstatement about one specific project.
const OVERSTATED_LABELS_BY_SLUG = {
  waypoint: ['Live demo', 'Demo', 'Live'],
}

/**
 * Check a parsed content model against the publishing rules.
 *
 * Pure: no filesystem, no network. Returns every failure rather than
 * throwing on the first, so one run tells you everything to fix.
 *
 * @param {object} profile parsed content/profile.json
 * @returns {{ok: boolean, failures: string[]}}
 */
export function checkContent(profile) {
  const failures = []
  const projects = profile.projects ?? []
  const seen = new Set()

  for (const project of projects) {
    const id = project.slug ?? '(no slug)'

    if (seen.has(project.slug)) {
      failures.push(`duplicate slug "${project.slug}" - each slug becomes a DOM id`)
    }
    seen.add(project.slug)

    if (!project.period) {
      failures.push(`${id}: missing period - every project must be dated`)
    } else if (PHONE_SHAPED.test(project.period)) {
      failures.push(
        `${id}: period "${project.period}" is phone-shaped and will trip the PII guard; ` +
          'use the month-name form ("Apr 2020 - Jun 2020") or a bare year ("2026")',
      )
    }

    const banned = OVERSTATED_LABELS_BY_SLUG[project.slug] ?? []
    for (const link of project.links ?? []) {
      if (banned.includes(link.label)) {
        failures.push(
          `${id}: link label "${link.label}" overstates a static landing page`,
        )
      }
    }
  }

  // Whole-model scan, and it genuinely is whole-model: JSON.stringify over
  // the ENTIRE profile, not a hand-listed subset. An earlier version scanned
  // only {projects, about} while its comment claimed whole-model reach, so a
  // retracted claim in an experience bullet or person.tagline passed the gate.
  // A guard that overstates its coverage is worse than one that admits a gap:
  // a maintainer trusts it and stops looking.
  //
  // about[] is included as of 2026-08-01. It was previously unscanned,
  // which is how a retracted paragraph could be edited with all tests
  // green (GAP no-retraction-gate-on-personal-site-prose).
  //
  // Lowercased once here, and the needles lowercased at the comparison
  // site below, so a claim reappearing at a sentence boundary ("The
  // property it ranked first...") is still caught even though its first
  // letter is capitalized there and lowercase in the needle. The
  // ORIGINAL-cased needle is kept in the failure message so the report
  // stays readable - only the comparison is case-insensitive.
  const serialized = JSON.stringify(profile).toLowerCase()
  for (const claim of BANNED_CLAIMS) {
    if (serialized.includes(claim.toLowerCase())) {
      failures.push(`banned claim "${claim}" appears in the content model`)
    }
  }
  for (const claim of RETRACTED_CLAIMS) {
    if (serialized.includes(claim.toLowerCase())) {
      failures.push(
        `retracted claim "${claim}" appears in the content model - ` +
          'it was corrected on review and must not return',
      )
    }
  }

  return { ok: failures.length === 0, failures }
}

/**
 * Classify an HTTP status from the URL liveness check.
 *
 * Split out of the CLI loop so it is testable, and so the
 * bot-block case is a NAMED outcome rather than an untested branch.
 *
 * The gate originally failed on any status other than 200. On
 * 2026-07-31 that failed a clean build because LinkedIn answered 999 -
 * its anti-automation response, not a real HTTP status - on a URL that
 * had returned 200 hours earlier the same day. A gate that a third
 * party can trip on correct content is worse than no gate: the tempting
 * fix under deadline is to delete the accurate link.
 *
 * 403 is deliberately NOT treated as a bot-block. On a portfolio, a 403
 * usually means a repo went private, and a link a recruiter cannot open
 * is a real defect worth failing on.
 *
 * @param {number} status HTTP status, or 0 for a network-level failure
 * @returns {'ok'|'blocked'|'dead'}
 */
export function classifyUrlStatus(status) {
  if (status === 200) return 'ok'
  // 999: LinkedIn anti-automation. 429: rate limited, transient.
  // 0: the CLI's catch handler produces this for ANY thrown fetch -
  // DNS failure, timeout, TLS reset, connection refused. It means the
  // CHECKER's call failed, which is not evidence about the target. Code
  // review 2026-07-31 caught this bucketed with 404/410/500, so a
  // transient blip failed the build on a live URL - the same failure
  // class the 999 case was written to remove, arriving via the
  // exception path instead of a status code.
  if (status === 999 || status === 429 || status === 0) return 'blocked'
  return 'dead'
}

// CLI. Guarded so importing this from a test never calls process.exit().
if (import.meta.url === `file://${process.argv[1]}`) {
  const profile = JSON.parse(readFileSync('content/profile.json', 'utf8'))
  const { failures } = checkContent(profile)

  for (const failure of failures) console.error(`  FAIL  ${failure}`)

  if (process.argv.includes('--check-urls')) {
    const urls = [
      ...new Set([...JSON.stringify(profile).matchAll(/https:\/\/[^"]+/g)].map((m) => m[0])),
    ].sort()
    for (const url of urls) {
      const status = await fetch(url, { redirect: 'follow' })
        .then((r) => r.status)
        .catch(() => 0)
      const verdict = classifyUrlStatus(status)
      if (verdict === 'ok') {
        console.log(`  ok    ${url}`)
      } else if (verdict === 'blocked') {
        // Reported loudly but NOT counted as a failure - the link is
        // fine, the checker just cannot see it.
        console.warn(`  warn  ${url} returned ${status} (bot-blocked, not verifiable from here)`)
      } else {
        console.error(`  FAIL  ${url} returned ${status}`)
        // Same "id: message" shape as checkContent's failures - they
        // share this array, and only .length is read today, but a bare
        // URL beside structured strings would print inconsistently if
        // anything ever dumped the array verbatim.
        failures.push(`${url}: returned ${status}`)
      }
    }
  }

  console.log(failures.length === 0 ? '\nPASS' : `\nFAIL (${failures.length})`)
  process.exit(failures.length === 0 ? 0 : 1)
}
