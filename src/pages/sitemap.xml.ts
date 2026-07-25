// src/pages/sitemap.xml.ts - sitemap for /, /llms.txt, and /api/profile.json.
import type { APIRoute } from 'astro'
import profile from '../../content/profile.json'
import { renderSitemapXml } from '../lib/agentSurface'

export const GET: APIRoute = () => {
  return new Response(renderSitemapXml(profile), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}
