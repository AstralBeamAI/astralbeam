# @astralbeam/www

Cinematic "mission console" landing page for astralbeam.ai, inspired by the HUD/cockpit aesthetic of sazabi.com but translated into AstralBeam's own starship-bridge identity (deep space, neon-teal beam, scanlines, mono readouts).

Plain Astro + hand-rolled CSS + vanilla TS. No React, no Tailwind, no runtime deps.

- `pnpm dev` — dev server on :3001
- `pnpm build` — static build to `dist/`
- `pnpm preview` — preview server on :4001
- `pnpm deploy` — build + `wrangler deploy` (worker: `www-astralbeam-ai`)

Structure:

- `src/pages/index.astro` — the whole page (hero, transmission, systems, deploy sequence, open source, launch) plus HUD chrome
- `src/pages/404.astro` — "SIGNAL LOST" error page (wrangler `404-page` handling)
- `src/styles/global.css` — all styling; design tokens in `:root`
- `src/scripts/main.ts` — canvas starfield, scramble-in headlines, scroll reveals, terminal typing, boot log, HUD scroll/sector readouts

All animation respects `prefers-reduced-motion`. Fonts are self-hosted via @fontsource (Anton / Space Grotesk / JetBrains Mono).
