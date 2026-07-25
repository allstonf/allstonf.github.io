// astro.config.mjs - Astro build config for the v2 rebuild of allstonf.github.io.
//
// This is a GitHub Pages USER site (allstoncodes.github.io equivalent for
// allstonf.github.io), so it is served from the domain root, not a
// project subpath. That is why `base` is "/" rather than a repo-name
// prefix - a project-site config (e.g. "/my-repo/") would break every
// absolute link on a user site.
//
// The React integration is registered now, in Task 1, even though this
// task ships zero React components and zero client JavaScript. Task 4
// adds the first island; wiring the integration here means that later
// task needs no config change, only a new .tsx file and a client:*
// directive.
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://allstonf.github.io',
  base: '/',
  integrations: [react()],
});
