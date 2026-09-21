# @astralbeam/www

Cinematic "mission console" landing page for astralbeam.ai, translated into AstralBeam's own starship-bridge identity (deep space, neon-teal beam, scanlines, mono readouts).

Plain Astro + hand-rolled CSS + vanilla TypeScript, managed and run by Deno. No React, no Tailwind, no client framework runtime, and no dependency on another AstralBeam project.

Run common commands from the repository root:

```sh
deno task --cwd www dev      # development server on 4600
deno task --cwd www build    # static output in dist/
deno task --cwd www preview  # production preview on 4001
deno task --cwd www ready    # check, build, then test
deno task --cwd www deploy   # ready, then deploy to Cloudflare
```

`ready` builds before testing because the tests inspect `dist/`. Use `deploy` only when publishing the website is intended.

Structure:

- `src/layouts/SiteLayout.astro`, shared document shell, search/social metadata, icons, manifest, and Organization structured data
- `src/pages/index.astro`, the whole page (hero with the agent-sidebar prototype, three integration step sections with code and benefit tiles, integrations, open source, launch) plus HUD chrome. Benefits and integrations marked `soon` render an "IN PROGRESS" tag or a dashed chip
- `public/demo/`, the sample CSV and spreadsheet the hero prototype's attachment and artifact chips download
- `src/pages/404.astro`, "SIGNAL LOST" error page (wrangler `404-page` handling)
- `src/pages/*.ts`, prerendered metadata resources, sitemap, icons, social image, `robots.txt`, and `llms.txt`
- `src/assets/`, website-owned logos
- `src/brand/palette.ts`, website-owned sRGB colors used by generated metadata images
- `src/brand/theme.schema.json`, hardcoded public theme schema snapshot
- `src/styles/global.css`, all styling, including website-owned semantic colors under explicit theme selectors
- `src/scripts/main.ts`, canvas starfield, scramble-in headlines, scroll reveals, per-snippet terminal typing, and the hardcoded agent-sidebar prototype replay in the hero
- `src/pages/schemas/theme.schema.json.ts`, prerendered route that publishes the website-owned schema snapshot
- `scripts/verify-build.test.ts`, Deno-executed Vitest contract tests for page metadata and every generated discovery asset

All animation respects `prefers-reduced-motion`. Fonts are self-hosted via @fontsource (Anton / Space Grotesk / JetBrains Mono).

## License

Except for third-party material, files in this project are licensed under the [MIT License](../LICENSE-MIT). See [third-party notices](../docs/legal/THIRD_PARTY_NOTICES.md) for bundled fonts.
