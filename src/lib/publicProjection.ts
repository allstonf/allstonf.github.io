// src/lib/publicProjection.ts - the security-critical public API shape.
//
// Builds the projection served at /api/profile.json FROM an explicit
// per-object field allowlist, never by copying a subtree of
// content/profile.json and pruning it afterward. This is a direct port
// of v1's build/build.py PUBLIC_*_FIELDS tuples + pick() +
// render_api_profile().
//
// v1 originally copied whole person/projects/experience subtrees into
// the public artifact. That failed OPEN: an internal editorial note
// attached to one of those objects was served on a public URL. Building
// FROM an allowlist instead means an unrecognized key can never survive
// projection - there is no code path that would carry it through. A
// field added to content/profile.json for local or editorial reasons
// does not publish itself; it has to be added to one of the tuples
// below on purpose. Preserve this property exactly - a filter-then-
// prune implementation would be a defect even with green tests, because
// the next field someone adds would publish itself.

// -- Per-object field allowlists, ported verbatim from build.py. --

export const PUBLIC_PERSON_FIELDS = [
  'name',
  'headline',
  'tagline',
  'location',
  'email',
  'current_role',
  'education',
  'knows_about',
  'profiles',
  'resume',
] as const

export const PUBLIC_CURRENT_ROLE_FIELDS = [
  'title',
  'employer',
  'employer_url',
  'start',
  'location',
] as const

export const PUBLIC_EDUCATION_FIELDS = [
  'institution',
  'institution_url',
  'credential',
  'detail',
] as const

export const PUBLIC_SOCIAL_PROFILE_FIELDS = ['label', 'url', 'handle'] as const

export const PUBLIC_RESUME_FIELDS = ['url', 'label'] as const

export const PUBLIC_PROJECT_FIELDS = [
  'slug',
  'name',
  'featured',
  'summary',
  'outcome',
  'bullets',
  'stack',
  'links',
] as const

export const PUBLIC_LINK_FIELDS = ['label', 'url'] as const

export const PUBLIC_EXPERIENCE_FIELDS = [
  'employer',
  'title',
  'start',
  'end',
  'location',
  'bullets',
] as const

/**
 * Return a new object containing only `fields`, in allowlist order.
 *
 * The single primitive behind the fail-closed projection. Because the
 * result is BUILT FROM the allowlist rather than copied from `source`
 * and then pruned, a key in `source` that is not named in `fields`
 * cannot survive - there is no code path that would carry it through.
 * A field missing from `source` is skipped rather than raising, so an
 * optional field (e.g. a project with no outcome yet) stays optional in
 * the output instead of appearing as an explicit null.
 */
export function pick(
  source: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const field of fields) {
    if (field in source) {
      result[field] = source[field]
    }
  }
  return result
}

/**
 * Build the public projection of `profile`: the exact shape served at
 * /api/profile.json. Every nested object is rebuilt through pick()
 * against its own allowlist above. The top-level `_meta`, `site`, and
 * `agent_surface` sections of content/profile.json are omitted
 * entirely, and any field nested inside person/projects/experience that
 * is not on an allowlist is dropped by construction, not by a denylist.
 *
 * `profile` is typed loosely (matches the shape of content/profile.json
 * at runtime) rather than against a generated JSON-schema type, since
 * the content model is hand-authored and this function's own allowlist
 * tuples are the actual contract being enforced here.
 */
export function publicProjection(profile: {
  person: Record<string, unknown>
  about: unknown
  projects?: Record<string, unknown>[]
  experience?: Record<string, unknown>[]
}): Record<string, unknown> {
  const person = pick(profile.person, PUBLIC_PERSON_FIELDS)
  if ('current_role' in person) {
    person.current_role = pick(
      person.current_role as Record<string, unknown>,
      PUBLIC_CURRENT_ROLE_FIELDS,
    )
  }
  if ('education' in person) {
    person.education = pick(person.education as Record<string, unknown>, PUBLIC_EDUCATION_FIELDS)
  }
  if ('resume' in person) {
    person.resume = pick(person.resume as Record<string, unknown>, PUBLIC_RESUME_FIELDS)
  }
  if ('profiles' in person) {
    person.profiles = (person.profiles as Record<string, unknown>[]).map((entry) =>
      pick(entry, PUBLIC_SOCIAL_PROFILE_FIELDS),
    )
  }

  const projects = (profile.projects ?? []).map((project) => {
    const publicProject = pick(project, PUBLIC_PROJECT_FIELDS)
    publicProject.links = ((project.links as Record<string, unknown>[]) ?? []).map((link) =>
      pick(link, PUBLIC_LINK_FIELDS),
    )
    return publicProject
  })

  const experience = (profile.experience ?? []).map((job) => pick(job, PUBLIC_EXPERIENCE_FIELDS))

  return {
    person,
    about: profile.about,
    projects,
    experience,
  }
}
