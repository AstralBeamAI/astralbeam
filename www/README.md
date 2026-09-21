# @astralbeam/www

Cinematic "mission console" landing page for astralbeam.ai, translated into AstralBeam's own starship-bridge identity (deep space, neon-teal beam, scanlines, mono readouts).

TanStack Start + hand-rolled CSS + vanilla TypeScript, managed and run by Deno. Every route is prerendered at build time, so `.output/public/` is plain static assets and the server bundle beside it goes unused. No Tailwind and no dependency on another AstralBeam project.

Run common commands from the repository root:

```sh
deno task --cwd www dev      # development server on 4600
deno task --cwd www build    # static output in .output/public/
deno task --cwd www preview  # production preview on 4001
deno task --cwd www ready    # check, build, then test
deno task --cwd www deploy   # ready, then deploy to Cloudflare
```

`ready` builds before testing because the tests inspect `.output/public/`. Use `deploy` only when publishing the website is intended.

Structure:

- `src/routes/__root.tsx`, shared document shell, search/social metadata, icons, manifest, and Organization structured data
- `src/routes/index.tsx`, the whole page (hero with the agent-sidebar prototype, three integration step sections with code and benefit tiles, integrations, open source, launch) plus HUD chrome
- `src/routes/-landing/`, the landing page's step and integration copy, its TSX token highlighter, and the scripted agent-sidebar transcript. Benefits and integrations marked `soon` render an "IN PROGRESS" tag or a dashed chip
- `public/demo/`, the sample CSV and spreadsheet the hero prototype's attachment and artifact chips download
- `src/routes/404.tsx`, "SIGNAL LOST" error page, prerendered to `404.html` for wrangler `404-page` handling and reused as the router's `notFoundComponent`
- `src/routes/*[.]*.ts`, prerendered metadata resources, sitemap, icons, social image, `robots.txt`, and `llms.txt`. The `[.]` escapes keep the dot in the URL instead of nesting a route
- `src/assets/`, website-owned logos
- `src/brand/palette.ts`, website-owned sRGB colors used by generated metadata images
- `src/brand/theme.schema.json`, hardcoded public theme schema snapshot
- `src/styles/`, all styling. `index.css` is the single linked stylesheet, pulling in the fonts, `global.css` (website-owned semantic colors under explicit theme selectors), and the legal pages' shell
- `src/scripts/main.ts`, canvas starfield, scramble-in headlines, scroll reveals, per-snippet terminal typing, and the hardcoded agent-sidebar prototype replay in the hero. The landing route starts it from an effect, and it owns that DOM outright afterwards
- `src/routes/schemas/theme[.]schema[.]json.ts`, prerendered route that publishes the website-owned schema snapshot
- `scripts/verify-build.test.ts`, Vitest contract tests for page metadata and every generated discovery asset

`vite.config.ts` lists every prerendered route. Add a route there when adding a page, otherwise the build will not emit it.

Two caveats for the development server. Vite claims `.png` requests before Nitro sees them, so `/favicon.png` and `/og-image.png` answer 404 under `dev` while building them correctly. Nitro also registers its public output directory as a top-level asset root, so do not point `output.publicDir` back inside the project: every path the last build wrote a file for would then fail under `dev`.

All animation respects `prefers-reduced-motion`. Fonts are self-hosted via @fontsource (Anton / Space Grotesk / JetBrains Mono).

## License

Except for third-party material, files in this project are licensed under the [MIT License](../LICENSE-MIT). See [third-party notices](../docs/legal/THIRD_PARTY_NOTICES.md) for bundled fonts.
