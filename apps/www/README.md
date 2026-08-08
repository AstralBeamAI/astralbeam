# @astralbeam/www

Cinematic "mission console" landing page for astralbeam.ai, inspired by the HUD/cockpit aesthetic of sazabi.com but translated into AstralBeam's own starship-bridge identity (deep space, neon-teal beam, scanlines, mono readouts).

Plain Astro + hand-rolled CSS + vanilla TypeScript. No React, no Tailwind, and no client framework runtime.

- `vp run @astralbeam/www#dev` — development server on port 3001
- `vp run @astralbeam/www#build` — static build to `dist/`
- `vp run @astralbeam/www#preview` — production preview on port 4001
- `vp run @astralbeam/www#test` — Astro diagnostics, production build, and generated-output verification
- `vp run @astralbeam/www#deploy` — diagnose, build, verify, and deploy the `www-astralbeam-ai` worker

Structure:

- `src/layouts/SiteLayout.astro` — shared document shell, search/social metadata, icons, manifest, and Organization structured data
- `src/pages/index.astro` — the whole page (hero, transmission, systems, deploy sequence, open source, launch) plus HUD chrome
- `src/pages/404.astro` — "SIGNAL LOST" error page (wrangler `404-page` handling)
- `src/pages/*.ts` — prerendered metadata resources, sitemap, icons, social image, `robots.txt`, and `llms.txt`
- `src/styles/global.css` — all styling; design tokens in `:root`
- `src/scripts/main.ts` — canvas starfield, scramble-in headlines, scroll reveals, terminal typing, boot log, HUD scroll/sector readouts
- `scripts/verify-build.test.ts` — Vite+/Vitest contract tests for page metadata and every generated discovery asset

All animation respects `prefers-reduced-motion`. Fonts are self-hosted via @fontsource (Anton / Space Grotesk / JetBrains Mono).
