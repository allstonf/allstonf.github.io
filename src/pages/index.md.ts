// src/pages/index.md.ts - markdown twin of the human index.astro page.
//
// Referenced by <link rel="alternate" type="text/markdown"> in
// index.astro's <head>. New in v2 (no v1 equivalent): measured with
// cl100k_base on 2026-08-01, root.html is 7,698 tokens and this page is
// 2,565 tokens, 66.7% fewer for an agent to read than the rendered HTML
// page - and it outperforms llms.txt alone for a question answered by
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
