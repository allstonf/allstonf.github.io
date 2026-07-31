// src/pages/sitemap.xml.ts - sitemap for /, /llms.txt, /resume.md, and
// /api/profile.json. The path list itself lives in renderSitemapXml().
import type { APIRoute } from 'astro'
import profile from '../../content/profile.json'
import { renderSitemapXml } from '../lib/agentSurface'

export const GET: APIRoute = () => {
  return new Response(renderSitemapXml(profile), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}
