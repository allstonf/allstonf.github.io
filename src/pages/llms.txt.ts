// src/pages/llms.txt.ts - agent surface: llmstxt.org convention file.
//
// Static-prerendered under Astro's default output mode, so this
// produces a real dist/llms.txt file at build time, not a server route.
import type { APIRoute } from 'astro'
import profile from '../../content/profile.json'
import { renderLlmsTxt } from '../lib/agentSurface'

export const GET: APIRoute = () => {
  return new Response(renderLlmsTxt(profile), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
