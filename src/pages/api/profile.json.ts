// src/pages/api/profile.json.ts - the security-critical public projection.
//
// Serves publicProjection(profile), built FROM an explicit allowlist
// (src/lib/publicProjection.ts) rather than by copying and pruning a
// subtree of content/profile.json - see that module's docstring for
// why. The top-level _meta, site, and agent_surface sections of the
// content model are never reachable here.
import type { APIRoute } from 'astro'
import profile from '../../../content/profile.json'
import { publicProjection } from '../../lib/publicProjection'

export const GET: APIRoute = () => {
  const body = JSON.stringify(publicProjection(profile), null, 2) + '\n'
  return new Response(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
