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
 */
function formatDateRange(start: string, end: string | null | undefined): string {
  return `${start} - ${end ? end : 'Present'}`
}

// How many of person.knows_about's entries to fold into the llms.txt
// blockquote's "focused on ..." clause. knows_about is the content
// model's literal "what does this person focus on" field, so it is the
// natural source for that clause rather than inventing a new one - two
// entries keeps the blockquote a single readable sentence rather than
// listing the whole skills array.
const FOCUS_AREA_COUNT = 2

/**
 * Build the ONE-sentence third-person summary shared by llms.txt's
 * blockquote and llms-full.txt's header: "[Name] is [role] at
 * [organization], focused on [area], [area]." Third person even though
 * index.astro's body is first person, because these two files are
 * machine-facing summaries, not the human page's voice - see the
 * evidence-basis note atop this file.
 */
function buildLlmsTxtSummary(profile: any): string {
  const { person } = profile
  const currentRole = person.current_role
  const focusAreas = (person.knows_about ?? []).slice(0, FOCUS_AREA_COUNT).join(' and ')
  return `${person.name} is ${currentRole.title} at ${currentRole.employer}, focused on ${focusAreas}.`
}

/**
 * Render llms.txt per the actual llmstxt.org spec: an H1 (the ONLY
 * required section - the person's name, not marketing copy), a
 * blockquote summary, a "## Docs" section with exactly one entry (the
 * /index.md markdown mirror - not one fabricated entry per anchor on
 * that single page), and a "## Optional" section (GitHub + LinkedIn +
 * resume, which per spec "can be skipped if a shorter context is
 * needed"). Every URL sink here runs through validateUrl() before it
 * reaches the file, the same guarantee every href on index.astro gets.
 *
 * Deliberately drops the old free-text agent_surface.llms_txt_intro /
 * llms_txt_guidance paragraphs this function used to emit: neither is
 * part of the llmstxt.org spec, and Google's 2026-05-15 "AI
 * manipulation" spam classification explicitly names "content
 * structured primarily to be cited by AI rather than to answer a
 * reader's question" - a guidance paragraph aimed at correcting an
 * agent's stale answer is exactly that shape. The underlying fact (Apple,
 * not Cisco, is current) still reaches every agent surface: the
 * blockquote below states the current employer directly, and the /
 * index.md this file points to carries the full Experience timeline
 * with an explicit "Present" end date.
 */
export function renderLlmsTxt(profile: any): string {
  const { person, site } = profile
  const siteUrl = validateUrl(site.url, 'site.url').replace(/\/+$/, '')

  const lines: string[] = [
    `# ${person.name}`,
    '',
    `> ${buildLlmsTxtSummary(profile)}`,
    '',
    '## Docs',
    '',
    `- [index.md](${siteUrl}/index.md): Full page content in markdown.`,
    '',
    '## Optional',
    '',
  ]

  for (const profileLink of person.profiles ?? []) {
    const url = validateUrl(profileLink.url, 'person.profiles[].url')
    lines.push(`- [${profileLink.label}](${url}): ${profileLink.handle}`)
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
 * Render llms-full.txt: the same H1 + blockquote header as llms.txt,
 * followed by the FULL markdown body - mechanically derived by calling
 * renderIndexMd() (defined below), never a second hand-maintained copy
 * of the page content. llms-full.txt is not part of the llmstxt.org
 * spec itself (that spec's own CLI generates llms-ctx.txt /
 * llms-ctx-full.txt); llms-full.txt is the separate industry convention
 * several major sites (Anthropic, Vercel) ship, chosen here because
 * this site is exactly one page, so "the full content" already exists
 * as renderIndexMd()'s output and reusing it is the only way this file
 * can never drift from /index.md.
 *
 * Carries an explicit "generated, do not hand-edit" comment for the
 * same reason every other generated artifact in this vault does: a
 * hand-edit here would silently diverge from index.md on the next
 * rebuild.
 */
export function renderLlmsFullTxt(profile: any): string {
  const { person } = profile

  const header = [
    '<!--',
    '  llms-full.txt is a GENERATED file - do not hand-edit it.',
    '  It is mechanically derived from content/profile.json via the same',
    '  renderIndexMd() function that produces /index.md, specifically so',
    '  the two files cannot silently diverge. Edit content/profile.json',
    '  and re-run the build instead.',
    '-->',
    '',
    `# ${person.name}`,
    '',
    `> ${buildLlmsTxtSummary(profile)}`,
    '',
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
    // alongside llms-full.txt in Task 6.
    `# Full-content agent surface: ${siteUrl}/llms-full.txt`,
  )

  return lines.join('\n') + '\n'
}

/** Escape the characters that are structurally significant in XML text content. */
function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Render sitemap.xml as a urlset for /, /llms.txt, and /api/profile.json.
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
  const paths = ['/', '/llms.txt', '/api/profile.json']

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
 * (name, current role, tagline, About, Projects, Experience), for the
 * <link rel="alternate" type="text/markdown"> affordance. New in v2;
 * v1 has no equivalent.
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
    '## About',
    '',
  ]

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
