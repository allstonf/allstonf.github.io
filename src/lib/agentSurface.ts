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

/**
 * Render llms.txt per the llmstxt.org convention: an H1 name, a
 * blockquote summary, the free-text intro/guidance from
 * agent_surface.*, then markdown sections for projects and experience.
 * Direct port of build.py's render_llms_txt().
 */
export function renderLlmsTxt(profile: any): string {
  const { person, site, agent_surface: agent } = profile

  const lines: string[] = [
    `# ${person.name}`,
    '',
    `> ${site.description}`,
    '',
    agent.llms_txt_intro,
    '',
    agent.llms_txt_guidance,
    '',
    '## Projects',
    '',
  ]

  for (const project of profile.projects ?? []) {
    const links = project.links ?? []
    if (links.length > 0) {
      lines.push(`- [${project.name}](${links[0].url}): ${project.summary}`)
    } else {
      lines.push(`- ${project.name}: ${project.summary}`)
    }
  }

  lines.push('', '## Experience', '')
  for (const job of profile.experience ?? []) {
    lines.push(`- ${job.employer} - ${job.title} (${formatDateRange(job.start, job.end)})`)
  }

  return lines.join('\n') + '\n'
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
  lines.push(`Sitemap: ${siteUrl}/sitemap.xml`, `# Agent-readable profile: ${siteUrl}/llms.txt`)

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
