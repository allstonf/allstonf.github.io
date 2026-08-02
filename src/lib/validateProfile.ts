// src/lib/validateProfile.ts - whole-document content-model invariants
// that no per-value escaping helper can catch, ported verbatim (in
// intent and regex) from v1's build/build.py validate_profile().
//
// These are checks across the ENTIRE profile document, not a single
// field, so they cannot live next to a single render call the way
// validateUrl() does - a duplicate slug or a malformed email is a
// property of the whole projects[] array / the whole person object,
// not of one value in isolation. index.astro calls validateProfile()
// once, before any rendering, so the build fails loudly before it
// writes a partially-correct page - never at rendered-but-wrong.
//
// 1. Project slugs must be unique. Each slug becomes a DOM id
//    (id="project-<slug>" plus its "-heading" partner via
//    aria-labelledby), so a duplicate emits invalid HTML and breaks
//    the screen-reader association between a project card and its own
//    heading.
// 2. The email must match a conservative shape. It is interpolated
//    into href={`mailto:${person.email}`} in index.astro. Astro's
//    automatic attribute escaping neutralizes quotes and angle
//    brackets, but a browser decodes HTML entities BEFORE it parses
//    the mailto: URI - so an "&" or "?" in the address survives
//    escaping intact and becomes a real mailto parameter (&body=,
//    &cc=) on a live public page. Escaping cannot fix this; only
//    rejecting the shape at build time can.
//
// Ported pattern, unchanged: ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

/**
 * Thrown when content/profile.json violates a whole-document invariant.
 *
 * Callers let this propagate and abort the Astro build rather than
 * catching it - a violation here is an authoring mistake in the
 * content model, and a loud build-time failure beats shipping a page
 * with broken aria-labelledby wiring or a poisoned mailto: link.
 */
export class ProfileValidationError extends Error {}

/**
 * Throw ProfileValidationError if `profile` violates either
 * whole-document invariant described above. Returns nothing on
 * success (validation is a gate, not a transform - it never mutates or
 * returns a modified profile).
 */
export function validateProfile(profile: { person: { email: unknown }; projects?: { slug?: unknown }[] }): void {
  const slugs = (profile.projects ?? []).map((project) => project.slug)
  // A slug is a duplicate if it appears more than once anywhere in the
  // array; dedupe + sort the OFFENDING slugs (not every project) so the
  // error message names each collision exactly once, in a stable order.
  const duplicates = [...new Set(slugs.filter((slug) => slugs.filter((s) => s === slug).length > 1))].sort()
  if (duplicates.length > 0) {
    throw new ProfileValidationError(
      `duplicate project slug(s) ${JSON.stringify(duplicates)}: each slug becomes a DOM id, ` +
        'so duplicates emit invalid HTML and break aria-labelledby',
    )
  }

  const email = String(profile.person.email)
  if (!EMAIL_PATTERN.test(email)) {
    throw new ProfileValidationError(
      `person.email ${JSON.stringify(email)} is not a plain address; it is rendered into ` +
        'href="mailto:..." where characters like & or ? become mailto parameters',
    )
  }
}
