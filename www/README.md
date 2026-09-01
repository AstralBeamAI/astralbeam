# @astralbeam/www

Cinematic "mission console" landing page for astralbeam.ai, translated into AstralBeam's own starship-bridge identity (deep space, neon-teal beam, scanlines, mono readouts).

Plain Astro + hand-rolled CSS + vanilla TypeScript, managed and run by Deno. No React, no Tailwind, no client framework runtime, and no dependency on another AstralBeam project.

- `deno task dev` — development server on port 4600
- `deno task build` — static build to `dist/`
- `deno task preview` — production preview on port 4001
- `deno task check` — formatting, linting, type diagnostics, and Knip
- `deno task test` — Astro diagnostics, production build, and generated-output verification
- `deno task deploy` — diagnose, build, verify, and deploy the `www-astralbeam-ai` worker

Structure:

- `src/layouts/SiteLayout.astro` — shared document shell, search/social metadata, icons, manifest, and Organization structured data
- `src/pages/index.astro` — the whole page (hero, compare, quickstart, features, open source, launch) plus HUD chrome
- `src/pages/404.astro` — "SIGNAL LOST" error page (wrangler `404-page` handling)
- `src/pages/*.ts` — prerendered metadata resources, sitemap, icons, social image, `robots.txt`, and `llms.txt`
- `src/assets/` — website-owned logos
- `src/brand/palette.ts` — website-owned sRGB colors used by generated metadata images
- `src/brand/theme.schema.json` — hardcoded public theme schema snapshot
- `src/styles/global.css` — all styling, including website-owned semantic colors under explicit theme selectors
- `src/scripts/main.ts` — canvas starfield, scramble-in headlines, scroll reveals, terminal typing, and the hardcoded agent-sidebar prototype replay
- `src/pages/schemas/theme.schema.json.ts` — prerendered route that publishes the website-owned schema snapshot
- `scripts/verify-build.test.ts` — Deno-executed Vitest contract tests for page metadata and every generated discovery asset

All animation respects `prefers-reduced-motion`. Fonts are self-hosted via @fontsource (Anton / Space Grotesk / JetBrains Mono).

## License

Except for third-party material, files in this project are licensed under the [MIT License](../LICENSE-MIT). See [third-party notices](../docs/legal/THIRD_PARTY_NOTICES.md) for bundled fonts.
