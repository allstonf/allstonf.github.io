// src/pages/resume.md.ts - machine-readable resume for agent consumption.
//
// Derived from content/profile.json, the same source as the human page and
// every other agent surface, so it cannot drift from what the site says.
// It is deliberately NOT a conversion of the resume PDF: a second source of
// truth would drift, and the PDF carries contact details that must not be
// published to a permanent public history.
import type { APIRoute } from 'astro'
import profile from '../../content/profile.json'
import { renderResumeMd } from '../lib/agentSurface'

export const GET: APIRoute = () => {
  return new Response(renderResumeMd(profile), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
}
