// src/pages/llms-full.txt.ts - agent surface: the full-content twin of
// llms.txt.
//
// Not part of the llmstxt.org spec (that spec's own CLI generates
// llms-ctx.txt / llms-ctx-full.txt instead); llms-full.txt is the
// separate industry convention several major sites ship. Built by
// renderLlmsFullTxt(), which reuses the SAME renderIndexMd() function
// that produces /index.md rather than a second hand-maintained copy of
// the page content - see src/lib/agentSurface.ts for why that
// mechanical derivation is the load-bearing property here.
//
// Static-prerendered under Astro's default output mode, so this
// produces a real dist/llms-full.txt file at build time, not a server
// route.
import type { APIRoute } from 'astro'
import profile from '../../content/profile.json'
import { renderLlmsFullTxt } from '../lib/agentSurface'

export const GET: APIRoute = () => {
  return new Response(renderLlmsFullTxt(profile), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
