// src/pages/sitemap.xml.ts - sitemap for every published surface. The
// path list itself lives in renderSitemapXml().
//
// lastmod is resolved here, once, via resolveLastUpdated() (the git
// commit date of HEAD, falling back to profile._meta.last_updated when
// no git history is available - see src/lib/lastUpdated.ts) and passed
// into renderSitemapXml() explicitly, keeping that renderer itself pure
// and unit-testable with an injected value.
import type { APIRoute } from 'astro'
import profile from '../../content/profile.json'
import { renderSitemapXml } from '../lib/agentSurface'
import { resolveLastUpdated } from '../lib/lastUpdated'

export const GET: APIRoute = () => {
  const lastUpdated = resolveLastUpdated(profile)
  return new Response(renderSitemapXml(profile, lastUpdated), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}
