# allstonf.github.io

Personal site: bio, projects, work experience, resume, and contact info.
This is the v3 rebuild, an Astro static site replacing the 2020
Bootstrap/jQuery build (still present in `vendor/`, `bootstrap/`,
`jquery/`, `less/`, `sass/`, `css/`, `js/`, `img/`, and `grayscale.*` at
the repo root, kept only until GitHub Pages is switched over so the
live site does not 404 in the meantime).

## Stack

- **Astro**, static output, one page.
- **One React island** (`src/components/LoopExplainer.tsx`), hydrated
  client-side only for the interactive "try it yourself" panel under
  the Loop section; everything else on the page ships with no
  JavaScript at all.
- **Self-hosted fonts**: Montserrat 700 and Lora 400/700, subset to
  woff2 and served from `public/fonts/` (licence in
  `public/fonts/OFL.txt`). No font CDN.
- **Zero external network requests.** No analytics, no CDN assets, no
  third-party scripts. Verified by `tests/artifactHygiene.test.ts`.
- A single content model, `content/profile.json`, drives every
  rendered surface (the HTML page, the machine-readable files below,
  and `build/build.py`'s older v1 renderer, kept for parity checks).

## Agent surface

The site's whole thesis is that it should be as legible to an AI agent
reading it as to a person looking at it. Alongside `index.html`, the
build emits:

| File | What it is |
|---|---|
| `/llms.txt` | The [llmstxt.org](https://llmstxt.org) convention: an H1, a one-line summary, and links to the other machine-readable surfaces. |
| `/llms-full.txt` | The same page prose as `/index.md` (role, about, projects, experience, education), mechanically derived from `content/profile.json` so it can never drift from the page. Does **not** include the Loop section at all, including that section's static prose, which is server-rendered into `index.html` but not mirrored here. |
| `/index.md` | The page's content as plain markdown. |
| `/resume.md` | A markdown resume mirroring the PDF's content. |
| `/api/profile.json` | The raw content model, publicly served. |
| `/sitemap.xml` | Standard sitemap covering the routes above. |
| `robots.txt` | Explicitly allows the named AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) in addition to `*`. |

All of these are generated from `content/profile.json` by
`src/lib/agentSurface.ts` at build time. They are not hand-maintained
copies; edit the JSON and rebuild.

The page also carries a visible agent-view toggle (`data-view-toggle`)
that swaps the rendered page for its raw markdown source in place,
without a page navigation, so a person can see exactly what an agent
sees.

## DESIGN.md

[`DESIGN.md`](./DESIGN.md) at the repo root is a standalone, reusable
design spec: a black-canvas, full-bleed grayscale-photography aesthetic
with one mint accent carrying every interactive state. It documents
colors, typography, spacing, and component patterns as tokens, cross-
referenced against `src/styles/tokens.css`, so the spec and the
stylesheet cannot silently drift apart (`tests/designTokens.test.ts`
pins that invariant). It is written to be handed to someone building a
different project, not just as internal documentation for this one.

## Build and test

```sh
npm install
npm run dev          # local dev server
npm run build         # static build to dist/
npm run preview       # serve the built dist/ locally
npm test              # vitest, full suite
node scripts/check-js-budget.mjs   # gate: gzipped JS under 150 KB
```

`build/build.py` is the older v1 renderer for the same
`content/profile.json` content model, kept for reference; `npm run
build` does not invoke it. `tests/parity.test.ts` instead reads the
Astro build's own `dist/index.html` and checks it against
`content/profile.json` directly, so facts that matter to an agent
(current employer, education) are confirmed to render as visible text,
not only inside a JSON-LD block.
