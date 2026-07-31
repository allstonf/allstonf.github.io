// src/lib/agentSurface.ts - the machine-readable agent surface renderers.
//
// Ported from v1's build/build.py render_llms_txt() / render_robots_txt()
// / render_sitemap_xml(). index.md is new in v2: a markdown twin of the
// human page (src/pages/index.astro), referenced from that page's
// <head> via <link rel="alternate" type="text/markdown" href="/index.md">.
// A markdown page costs roughly 80% fewer tokens for an agent to read
// than the rendered HTML page and outperforms llms.txt alone for
// "answer a question found on this specific page" queries, since
// llms.txt is a summary/index rather than the full page content.
//
// Every function here reads only from the same content/profile.json
// content model that src/pages/index.astro renders, so the human and
// agent surfaces cannot describe two different people.
//
// Task 6 (AEO/GEO hardening) rewrote renderLlmsTxt() to the actual
// llmstxt.org spec (an H1, an optional blockquote, and ##-sectioned
// link lists - NOT a free-text guidance paragraph) and added
// renderLlmsFullTxt(), a generated (never hand-authored) full-content
// twin. The evidence basis for keeping this file lean: a 16,851-query
// study instrumented against a live retrieval pipeline found structural
// signals like this "add only 2-6 percentage points and cannot
// overcome poor retrieval or weak relevance" - so the goal here is a
// correct, unambiguous index, not an engineered extraction target.
import { validateUrl } from './url'

/**
 * Render a job's date range the same way index.astro's formatDateRange
 * does: "YYYY-MM - YYYY-MM", or "YYYY-MM - Present" for a still-current
 * role (end is null/undefined). Duplicated here rather than imported
 * from index.astro because an .astro file's frontmatter is not an
 * importable module from a plain .ts file; kept in sync by the shared
 * "plain hyphen, never an em dash" style rule and by the parity test in
 * tests/parity.test.ts that already asserts index.html's date range
 * matches this shape.
 *
 * `separator` exists only so renderResumeMd() can pass RESUME_DATE_SEPARATOR
 * (see the constant's own note for why the hyphen form is unusable there)
 * while every other caller keeps the index.astro-matching default and
 * therefore byte-identical output. One helper with one optional argument,
 * rather than a second near-identical date formatter that could drift.
 */
function formatDateRange(
  start: string,
  end: string | null | undefined,
  separator = ' - ',
): string {
  return `${start}${separator}${end ? end : 'Present'}`
}

// How many of person.knows_about's entries to fold into the llms.txt
// blockquote's "focused on ..." clause. knows_about is the content
// model's literal "what does this person focus on" field, so it is the
// natural source for that clause rather than inventing a new one - two
// entries keeps the blockquote a single readable sentence rather than
// listing the whole skills array.
const FOCUS_AREA_COUNT = 2

/**
 * Return "a" or "an" for `word`, by a plain leading-vowel-letter check.
 * Not a full English-grammar solver (it would mis-handle a leading
 * silent-h or acronym pronounced letter-by-letter), but current_role.title
 * is hand-authored prose in content/profile.json, not user input, and
 * this is enough to keep the llms.txt blockquote grammatical if that
 * title's wording changes later without a human re-checking the article.
 */
function indefiniteArticleFor(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word) ? 'an' : 'a'
}

/**
 * Build the ONE-sentence third-person summary shared by llms.txt's
 * blockquote and llms-full.txt's header: "[Name] is a [role], at
 * [organization], focused on [area] and [area]." Third person even
 * though index.astro's body is first person, because these two files
 * are machine-facing summaries, not the human page's voice - see the
 * evidence-basis note atop this file.
 *
 * Fix round 1: current_role.title itself carries an internal comma
 * ("Systems Software Engineer, Power and Performance"), so the title is
 * bracketed by commas on both sides rather than glued directly to "at"
 * - the earlier "is Systems Software Engineer ... at" phrasing was
 * missing the article "a" and read as a grammar error, which matters
 * because this is the single line an agent doing a quick lookup is most
 * likely to read and reuse verbatim.
 */
function buildLlmsTxtSummary(profile: any): string {
  const { person } = profile
  const currentRole = person.current_role
  const focusAreas = (person.knows_about ?? []).slice(0, FOCUS_AREA_COUNT).join(' and ')
  const article = indefiniteArticleFor(currentRole.title)
  return `${person.name} is ${article} ${currentRole.title}, at ${currentRole.employer}, focused on ${focusAreas}.`
}

/**
 * Build the shared header lines both renderLlmsTxt() and
 * renderLlmsFullTxt() prepend: H1, blockquote summary, then the
 * stale-employer disambiguation paragraph.
 *
 * Fix round 1: that disambiguation paragraph was dropped entirely in
 * the first pass on the theory that llms.txt should carry only the
 * llmstxt.org spec's H1/blockquote/##-sections - but the spec
 * explicitly permits "zero or more markdown sections... of any type
 * except headings" of free prose between the blockquote and the first
 * "##" heading, so a free-prose paragraph here is spec-compliant. More
 * importantly, the paragraph is not redundant with the blockquote's
 * positive "is at Apple" assertion: it is the deliberate mechanism that
 * RESOLVES a contradiction for an agent whose training data, or a
 * cached copy of the pre-rebuild site (which read "Software Engineer at
 * Cisco" from 2020 until this rebuild), disagrees with the current
 * content model. Reused verbatim from agent_surface.llms_txt_guidance
 * rather than reconstructed from person.current_role/experience/
 * profiles, per the instruction to prefer an existing hand-authored
 * field over rebuilding the same sentence from smaller pieces.
 */
function buildLlmsHeaderLines(profile: any): string[] {
  const { person, agent_surface: agent } = profile
  return [`# ${person.name}`, '', `> ${buildLlmsTxtSummary(profile)}`, '', agent.llms_txt_guidance, '']
}

/**
 * Render llms.txt per the actual llmstxt.org spec: an H1 (the ONLY
 * required section - the person's name, not marketing copy), a
 * blockquote summary, a free-prose disambiguation paragraph (spec-legal
 * per the "sections of any type except headings" clause - see
 * buildLlmsHeaderLines() above), a "## Docs" section listing one entry
 * per DISTINCT fetchable markdown resource (/index.md and, since Task 5,
 * /resume.md - never one fabricated entry per anchor within a single
 * page), and a "## Optional" section (GitHub +
 * LinkedIn + resume, which per spec "can be skipped if a shorter
 * context is needed"). Every URL sink here runs through validateUrl()
 * before it reaches the file, the same guarantee every href on
 * index.astro gets.
 *
 * Fix round 1: the "## Optional" entries no longer carry a trailing
 * ": handle" description - the link text is already the profile label
 * (e.g. "GitHub"), so repeating the handle added nothing per-spec's
 * "optional convention" wording.
 */
export function renderLlmsTxt(profile: any): string {
  const { person, site } = profile
  const siteUrl = validateUrl(site.url, 'site.url').replace(/\/+$/, '')

  const lines: string[] = [
    ...buildLlmsHeaderLines(profile),
    '## Docs',
    '',
    `- [index.md](${siteUrl}/index.md): Full page content in markdown.`,
    `- [resume.md](${siteUrl}/resume.md): Work history, skills and projects in markdown.`,
    '',
    '## Optional',
    '',
  ]

  for (const profileLink of person.profiles ?? []) {
    const url = validateUrl(profileLink.url, 'person.profiles[].url')
    lines.push(`- [${profileLink.label}](${url})`)
  }

  // Include the resume only if the content model actually carries one -
  // never fabricate the entry.
  if (person.resume?.url) {
    const resumeUrl = validateUrl(person.resume.url, 'person.resume.url')
    lines.push(`- [${person.resume.label}](${resumeUrl})`)
  }

  return lines.join('\n') + '\n'
}

/**
 * Render llms-full.txt: the same H1 + blockquote + disambiguation
 * header as llms.txt (via buildLlmsHeaderLines()), followed by the
 * page's prose body - mechanically derived by calling renderIndexMd()
 * (defined below), never a second hand-maintained copy of the page
 * content. llms-full.txt is not part of the llmstxt.org spec itself
 * (that spec's own CLI generates llms-ctx.txt / llms-ctx-full.txt);
 * llms-full.txt is the separate industry convention several major sites
 * (Anthropic, Vercel) ship. Reusing renderIndexMd()'s output is the
 * only way this file can never drift from /index.md.
 *
 * NOTE: despite the "full" name, this is the same markdown body as
 * /index.md - role, about, projects, experience, and education. It
 * does NOT include the page's interactive Loop section; that block is
 * rendered client-side only and has no markdown equivalent in this
 * file. An agent that needs the Loop content has to read index.html
 * directly. The full-text surface carries the SAME disambiguation
 * paragraph as llms.txt (fix round 1) - it is at least as
 * self-correcting as the lean index, never less.
 *
 * Carries an explicit "generated, do not hand-edit" comment for the
 * same reason every other generated artifact in this vault does: a
 * hand-edit here would silently diverge from index.md on the next
 * rebuild.
 */
export function renderLlmsFullTxt(profile: any): string {
  const header = [
    '<!--',
    '  llms-full.txt is a GENERATED file - do not hand-edit it.',
    '  It is mechanically derived from content/profile.json via the same',
    '  renderIndexMd() function that produces /index.md, specifically so',
    '  the two files cannot silently diverge. Edit content/profile.json',
    '  and re-run the build instead.',
    '-->',
    '',
    ...buildLlmsHeaderLines(profile),
  ].join('\n')

  return header + renderIndexMd(profile)
}

/**
 * Render robots.txt: welcomes every crawler, and calls out the named
 * AI/agent crawlers by name with an explicit Allow: /, per the spec -
 * this repo's entire point is being agent-legible. Direct port of
 * build.py's render_robots_txt().
 */
export function renderRobotsTxt(profile: any): string {
  const siteUrl = String(profile.site.url).replace(/\/+$/, '')
  const namedBots = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']

  const lines: string[] = ['User-agent: *', 'Allow: /', '']
  for (const bot of namedBots) {
    lines.push(`User-agent: ${bot}`, 'Allow: /', '')
  }
  lines.push(
    `Sitemap: ${siteUrl}/sitemap.xml`,
    `# Agent-readable profile: ${siteUrl}/llms.txt`,
    // Informal practice, not spec - a comment, not a directive. Added
    // alongside llms-full.txt in Task 6. "Full" refers to the full
    // prose body (role, about, projects, experience, education), not
    // the page's interactive Loop section - that section is not
    // included in this file.
    `# Agent surface (page prose, no Loop section): ${siteUrl}/llms-full.txt`,
  )

  return lines.join('\n') + '\n'
}

/** Escape the characters that are structurally significant in XML text content. */
function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Render sitemap.xml as a urlset for /, /llms.txt, /resume.md, and
 * /api/profile.json.
 *
 * lastmod comes from _meta.last_updated in the content model, NOT from
 * the current wall clock - using the wall clock would make a rebuild of
 * unchanged content produce different bytes, breaking the reproducible-
 * build property build.py's own test suite locks in. Built as a plain
 * template rather than with an XML DOM library: the only values in play
 * are the site URL and a hand-authored date string, both from the
 * trusted, hand-edited content model, and escapeXmlText() still guards
 * the text content in case that ever changes.
 */
export function renderSitemapXml(profile: any): string {
  const siteUrl = String(profile.site.url).replace(/\/+$/, '')
  const lastUpdated = profile._meta.last_updated
  const paths = ['/', '/llms.txt', '/resume.md', '/api/profile.json']

  const urlEntries = paths
    .map(
      (path) =>
        '  <url>\n' +
        `    <loc>${escapeXmlText(`${siteUrl}${path}`)}</loc>\n` +
        `    <lastmod>${escapeXmlText(lastUpdated)}</lastmod>\n` +
        '  </url>',
    )
    .join('\n')

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${urlEntries}\n` +
    '</urlset>\n'
  )
}

/**
 * Render index.md: a markdown twin of the human index.astro page
 * (name, current role, tagline, education, About, Projects,
 * Experience), for the <link rel="alternate" type="text/markdown">
 * affordance. New in v2; v1 has no equivalent.
 *
 * The education line was missing entirely until the review that
 * closed this gap: index.astro's header <dd> (fix round: visible
 * education text) added person.education to the HUMAN page, but this
 * function was never updated to match, so BOTH machine-readable
 * surfaces - this file and llms-full.txt, which is mechanically
 * derived from it - silently carried role/tagline/About/Projects/
 * Experience with no education. See the regression test in
 * tests/agentSurface.test.ts.
 */
export function renderIndexMd(profile: any): string {
  const { person, about, projects, experience } = profile
  const currentRole = person.current_role

  const lines: string[] = [
    `# ${person.name}`,
    '',
    `Currently: ${currentRole.title} at ${currentRole.employer}`,
    '',
    person.tagline,
    '',
    `Contact: ${person.email}`,
    '',
  ]

  // Mirror index.astro's own "only if the content model actually
  // carries one" guard (that page's `{person.education && (...)}`
  // block) - never fabricate an education line for a profile that
  // doesn't have one. A plain "Education: credential, institution
  // (detail)" line matches the surrounding "Currently: ..." / "Contact:
  // ..." plain-line style already used above, rather than inventing a
  // new heading convention for a single field.
  if (person.education) {
    const detailSuffix = person.education.detail ? ` (${person.education.detail})` : ''
    lines.push(
      `Education: ${person.education.credential}, ${person.education.institution}${detailSuffix}`,
      '',
    )
  }

  lines.push('## About', '')

  for (const paragraph of about ?? []) {
    lines.push(paragraph, '')
  }

  lines.push('## Projects', '')
  for (const project of projects ?? []) {
    lines.push(`### ${project.name}`, '', project.summary, '')
    if (project.outcome) {
      lines.push(`Outcome: ${project.outcome}`, '')
    }
    for (const bullet of project.bullets ?? []) {
      lines.push(`- ${bullet}`)
    }
    lines.push('')
  }

  lines.push('## Experience', '')
  for (const job of experience ?? []) {
    lines.push(
      `### ${job.employer} - ${job.title}`,
      '',
      `${formatDateRange(job.start, job.end)} - ${job.location}`,
      '',
    )
    for (const bullet of job.bullets ?? []) {
      lines.push(`- ${bullet}`)
    }
    lines.push('')
  }

  // Collapse any run of 3+ blank lines left behind by the per-section
  // trailing '' pushes above (e.g. a project with no outcome and no
  // trailing content still pushes one blank line, and the next section
  // header adds another) down to a single blank line, then trim the
  // final trailing blank before adding exactly one closing newline.
  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  )
}

// -- /resume.md: the machine-readable resume surface (Task 5). --

// The date separator /resume.md uses in place of the default " - ".
//
// Not a style choice. tests/resumeMd.test.ts enforces that this file
// contains no phone-shaped digit run, using the deliberately blunt
// /\+?\d[\d\s().-]{8,}\d/ shape check - and a closed range rendered as
// "2020-08 - 2022-06" IS that shape (17 characters of digits, spaces and
// hyphens). The guard cannot tell a date range from a phone number, and
// the fail-closed rule says the OUTPUT moves, never the guard: widening
// the regex to spare a date range would also spare a real space-separated
// phone number, which is the whole thing it exists to stop. The word
// separator breaks the run and reads correctly on a resume. (An example
// of such a number is deliberately NOT written here: the pii-audit gate
// scans source, not just built output, and a phone-shaped literal in a
// public repo is a finding even when it is fictional.)
// index.md keeps the hyphen form, since that file
// carries no such guarantee and must keep matching index.astro.
const RESUME_DATE_SEPARATOR = ' to '

/**
 * The ONLY skill groups /resume.md will publish, in publication order,
 * each an explicit `content/profile.json` key paired with its heading.
 *
 * This is the fail-closed half of the skills section. Iterating
 * Object.entries(profile.skills) would publish whatever key the content
 * model gains next, which is precisely how v1's render_api_profile()
 * put an internal editorial note on a public URL. Naming the keys here
 * means a fourth group added to profile.json is structurally incapable
 * of reaching the page until someone adds it to this list on purpose.
 *
 * The group names and their members come from the resume PDF, which is
 * canonical for this surface - they are not a taxonomy invented here.
 */
const RESUME_SKILL_GROUPS = [
  { key: 'programming_languages', label: 'Programming Languages' },
  { key: 'development_tools', label: 'Development Tools' },
  { key: 'ai_agent_tools', label: 'AI Agent Tools' },
] as const

/**
 * Render /resume.md: a bounded, machine-readable resume, so an agent
 * asked "what is Allston's experience" reads structured markdown instead
 * of extracting text from a PDF's layout, where reading order is a
 * property of the page geometry rather than of the document.
 *
 * Section order: name, current role, contact, summary, Skills,
 * Experience, Projects, Education.
 *
 * SAFETY: this string is served at a public URL from a public repository
 * whose history is permanent, so it is built the same fail-closed way
 * publicProjection() builds /api/profile.json - every value is read from
 * a NAMED field, never spread and never iterated out of an unknown key
 * set. Concretely: an experience entry contributes exactly employer,
 * title, start, end, location and bullets; a project contributes exactly
 * name, summary, outcome, bullets, stack and links; skills come only from
 * RESUME_SKILL_GROUPS above. Email may appear (it is already published on
 * this site and on the human page); person.location, a phone number, a
 * street address or any other contact detail must not, which is why the
 * contact line names person.email alone rather than assembling whatever
 * contact-shaped fields exist. tests/resumeMd.test.ts poisons the content
 * model at two depths to prove the property holds by construction.
 *
 * `profile` is typed loosely for the same reason publicProjection()'s
 * argument is: the content model is hand-authored, and the field names
 * read below are the actual contract.
 */
export function renderResumeMd(profile: any): string {
  const { person, skills, projects, experience } = profile
  const currentRole = person.current_role

  const lines: string[] = [
    `# ${person.name}`,
    '',
    `${currentRole.title} at ${currentRole.employer}`,
    '',
    `Contact: ${person.email}`,
    '',
    person.tagline,
    '',
    '## Skills',
    '',
  ]

  for (const group of RESUME_SKILL_GROUPS) {
    const members = skills?.[group.key]
    // Skip a group the content model does not carry rather than emitting
    // an empty heading, the same "only if it actually exists" guard
    // renderIndexMd() applies to person.education.
    if (members?.length) {
      lines.push(`- **${group.label}:** ${members.join(', ')}`)
    }
  }

  // person.knows_about is deliberately NOT published here (review round
  // 1). It is schema.org shaping that exists for the JSON-LD consumer in
  // jsonLd.ts, and for /index.md. Rendering it on this surface duplicated
  // Objective-C, C++ and Python against the Programming Languages group
  // above, and grew a 40-item skills section on a file that mirrors a
  // ONE-PAGE resume. The three groups above come from the PDF, which is
  // canonical for /resume.md; knows_about answers a different question
  // for a different consumer and stays in the content model untouched.
  lines.push('')

  lines.push('## Experience', '')
  for (const job of experience ?? []) {
    lines.push(
      `### ${job.employer} - ${job.title}`,
      '',
      `${formatDateRange(job.start, job.end, RESUME_DATE_SEPARATOR)} - ${job.location}`,
      '',
    )
    for (const bullet of job.bullets ?? []) {
      lines.push(`- ${bullet}`)
    }
    lines.push('')
  }

  // The project SET is whatever the content model carries. The resume
  // PDF and content/profile.json currently list different projects, and
  // which projects belong on a resume is the owner's call, not a
  // rendering decision - so this reconciles nothing and reorders nothing.
  lines.push('## Projects', '')
  for (const project of projects ?? []) {
    lines.push(`### ${project.name}`, '', project.summary, '')
    if (project.outcome) {
      lines.push(`Outcome: ${project.outcome}`, '')
    }
    for (const bullet of project.bullets ?? []) {
      lines.push(`- ${bullet}`)
    }
    if (project.stack?.length) {
      lines.push('', `Stack: ${project.stack.join(', ')}`)
    }
    // Blank line first, then one LIST ITEM per link. Both halves matter:
    // CommonMark fuses consecutive non-blank lines into a single
    // paragraph, so an earlier "Stack: ...\nLink: a\nLink: b" rendered as
    // one run-on sentence (review round 1). A blank line closes the Stack
    // paragraph, and a list item is its own block, so the links cannot
    // fuse into each other either.
    const links = project.links ?? []
    if (links.length) {
      lines.push('', 'Links:', '')
      for (const link of links) {
        // Every URL sink in this module runs through validateUrl() before
        // it ships, the same guarantee each href on index.astro gets.
        lines.push(`- [${link.label}](${validateUrl(link.url, 'projects[].links[].url')})`)
      }
    }
    lines.push('')
  }

  if (person.education) {
    const detailSuffix = person.education.detail ? ` (${person.education.detail})` : ''
    lines.push(
      '## Education',
      '',
      `${person.education.credential}, ${person.education.institution}${detailSuffix}`,
      '',
    )
  }

  // Same blank-line normalization renderIndexMd() ends with: collapse
  // the runs left by per-section trailing pushes, then exactly one
  // closing newline.
  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  )
}
