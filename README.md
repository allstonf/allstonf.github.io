# allstonf.github.io

Personal site: bio, projects, work experience, resume, and contact info.

An Astro static site, deployed to GitHub Pages by the workflow in
`.github/workflows/deploy.yml`. It replaced a 2020 Bootstrap/jQuery
build, whose files were removed from the repo once the Actions
deployment was verified live.

## Stack

- **Astro**, static output, one page. It is the only runtime dependency.
- **Effectively zero JavaScript.** The build ships 1.2 KB gzipped, all
  of it inline (a nav toggle and a view toggle). Nothing hydrates, and
  every piece of content renders as static HTML with JS disabled. The
  gate is 150 KB gzipped, enforced by `scripts/check-js-budget.mjs`.
- **Self-hosted fonts**: Montserrat 700 and Lora 400/700, subset to
  woff2 and served from `public/fonts/` (licence in
  `public/fonts/OFL.txt`). No font CDN.
- **Zero external network requests.** No analytics, no CDN assets, no
  third-party scripts. Verified by `tests/artifactHygiene.test.ts`.
- **One content model.** `content/profile.json` drives every rendered
  surface, so the human page and the machine-readable files cannot
  disagree about a fact.

## Agent surface

The site's thesis is that it should be as legible to an AI agent reading
it as to a person looking at it. Alongside the page, the build emits:

| File | What it is |
|---|---|
| `/llms.txt` | The [llmstxt.org](https://llmstxt.org) convention: an H1, a one-line summary, and links to the other machine-readable surfaces. |
| `/llms-full.txt` | The same page prose as `/index.md`, mechanically derived from it so the two cannot drift. |
| `/index.md` | The page's content as plain markdown. |
| `/resume.md` | A markdown resume mirroring the PDF. |
| `/api/profile.json` | The public projection of the content model, built from a per-field allowlist so an unrecognised field cannot publish itself. |
| `/sitemap.xml` | Standard sitemap covering the routes above. |
| `/robots.txt` | Explicitly allows the named AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) in addition to `*`. |

All are generated from `content/profile.json` by `src/lib/agentSurface.ts`
at build time. They are not hand-maintained copies: edit the JSON and
rebuild.

The page also carries a visible agent-view toggle that swaps the
rendered page for its markdown source in place, without a navigation, so
a person can see exactly what an agent sees.

## DESIGN.md

[`DESIGN.md`](./DESIGN.md) is a standalone, reusable design spec: a
black-canvas, full-bleed grayscale-photography aesthetic with one mint
accent carrying every interactive state. It documents colours,
typography, spacing, and component patterns as tokens, cross-referenced
against `src/styles/tokens.css`, so the spec and the stylesheet cannot
silently drift apart. `tests/designTokens.test.ts` pins that invariant by
parsing both. It is written to be handed to someone building a different
project, not only as internal documentation for this one.

## Build and test

```sh
npm install
npm run dev            # local dev server
npm run build          # static build to dist/
npm run preview        # serve the built dist/ locally
npm run lint           # biome check (lint + format)
npm test               # vitest, 229 tests
npm run verify:all     # everything below, in order
```

`verify:all` is the gate, and it is the same set of steps CI runs:

1. `biome check` - lint and format, no build needed, fails fastest
2. `astro build`
3. `vitest run` - includes an axe-core structural accessibility check
   against the real built HTML
4. `verify-content.mjs --check-urls` - content rules plus link liveness
5. `check-js-budget.mjs` - reference-aware gzipped JS budget
6. `check-css-budget.mjs` - the same for CSS, plus an informational
   unreferenced-selector report

It builds first on purpose: several suites read real artifacts from
`dist/`, and `dist/` is gitignored, so `npm test` alone fails on a cold
checkout.

Node 22.12 or newer is required (Astro's engine floor). CI pins 24.
