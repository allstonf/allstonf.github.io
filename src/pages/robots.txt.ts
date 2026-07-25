// src/pages/robots.txt.ts - crawl-control file, explicitly welcomes
// every crawler and names the AI/agent crawlers this repo is built for.
import type { APIRoute } from 'astro'
import profile from '../../content/profile.json'
import { renderRobotsTxt } from '../lib/agentSurface'

export const GET: APIRoute = () => {
  return new Response(renderRobotsTxt(profile), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
