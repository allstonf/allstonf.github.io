// src/pages/index.md.ts - markdown twin of the human index.astro page.
//
// Referenced by <link rel="alternate" type="text/markdown"> in
// index.astro's <head>. New in v2 (no v1 equivalent): a markdown page
// costs roughly 80% fewer tokens for an agent to read than the rendered
// HTML page, and outperforms llms.txt alone for a question answered by
// this specific page's content rather than by the summary/index that
// llms.txt is.
import type { APIRoute } from 'astro'
import profile from '../../content/profile.json'
import { renderIndexMd } from '../lib/agentSurface'

export const GET: APIRoute = () => {
  return new Response(renderIndexMd(profile), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
}
