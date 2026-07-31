// astro.config.mjs - Astro build config for allstonf.github.io.
//
// This is a GitHub Pages USER site, so it is served from the domain root,
// not a project subpath. That is why `base` is "/" rather than a repo-name
// prefix - a project-site config (e.g. "/my-repo/") would break every
// absolute link on a user site.
//
// The @astrojs/react integration was removed on 2026-07-31 along with the
// Loop section, which was the only React island the site ever shipped.
// Registering the integration is what caused Astro to emit a ~58 KB
// gzipped client renderer chunk even after the island stopped being
// mounted - unreachable, so no visitor downloaded it, but deployed on
// every build. If a future island is wanted, re-add the integration and
// the three dependencies together; the removal is one commit to revert.
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://allstonf.github.io',
  base: '/',
});
