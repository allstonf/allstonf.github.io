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
import { absolutizeUrl } from '../../lib/url'

export const GET: APIRoute = () => {
  // Absolutize BEFORE the projection, never after. publicProjection is the
  // fail-closed allowlist and has to be the LAST thing that touches this
  // payload; rewriting a value on its output would move the security gate
  // earlier in the chain than the final data, which is exactly the mistake
  // that let the v1 generator publish internal fields (see that module's
  // docstring).
  //
  // This document carries no origin field - its top-level keys are person,
  // about, projects and experience - and it is fetched directly rather than
  // loaded as a document, so a relative url in it is unresolvable to every
  // reader it exists for.
  const withAbsoluteUrls = {
    ...profile,
    person: {
      ...profile.person,
      resume: {
        ...profile.person.resume,
        url: absolutizeUrl(profile.person.resume.url, profile.site.url, 'person.resume.url'),
      },
    },
  }
  const body = `${JSON.stringify(publicProjection(withAbsoluteUrls), null, 2)}\n`
  return new Response(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
