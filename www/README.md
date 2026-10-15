# @astralbeam/www

Cinematic "mission console" landing page for astralbeam.ai, translated into AstralBeam's own starship-bridge identity (deep space, neon-teal beam, scanlines, mono readouts).

TanStack Start + hand-rolled CSS + vanilla TypeScript, managed and run by Bun. Every route is prerendered at build time, so `.output/public/` is plain static assets and the server bundle beside it goes unused. No Tailwind and no dependency on another AstralBeam project.

Run common commands from the repository root:

```sh
bun run --cwd www dev      # development server on 4600
bun run --cwd www build    # static output in .output/public/
bun run --cwd www preview  # production preview on 4001
bun run --cwd www ready    # check, build, then test
bun run --cwd www deploy   # ready, then deploy to Cloudflare
```

`ready` builds before testing because the tests inspect `.output/public/`. Use `deploy` only when publishing the website is intended.

For [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), keep the root directory at `www`, set `BUN_VERSION` to the version in the repository’s `.bun-version`, and use `bun install --frozen-lockfile && bun run build` as the build command. Bun installs the parent workspace. Use `bun run wrangler deploy` for production and `bun run wrangler versions upload` for preview branches. These dashboard settings are separate from `wrangler.json` and must be updated when changing build runtimes.

Structure:

- `src/routes/__root.tsx`, shared document shell, search/social metadata, icons, manifest, and Organization structured data
- `src/routes/index.tsx` and `src/routes/home.tsx`, the landing page at `/` and the copy the platform serves signed-in visitors at `/home`, both rendering `-landing/landing-page.tsx`
- `src/routes/-landing/landing-page.tsx`, the whole page (hero with the agent-sidebar prototype, three integration step sections with code and benefit tiles, integrations, open source, launch) plus HUD chrome
- `src/routes/-landing/`, the landing page's step and integration copy, its TSX token highlighter, and the scripted agent-sidebar transcript. Integrations marked `soon` render a dashed chip with an "In progress" tooltip
- `public/demo/`, the sample CSV and spreadsheet the hero prototype's attachment and artifact chips download
- `src/routes/404.tsx`, "SIGNAL LOST" error page, prerendered to `404.html` for wrangler `404-page` handling and reused as the router's `notFoundComponent`
- `src/routes/*[.]*.ts`, prerendered metadata resources, sitemap, icons, social image, `robots.txt`, and `llms.txt`. The `[.]` escapes keep the dot in the URL instead of nesting a route
- `src/assets/`, website-owned logos
- `src/brand/palette.ts`, website-owned sRGB colors used by generated metadata images
- `src/styles/`, all styling. `index.css` is the single linked stylesheet, pulling in the fonts, `global.css` (website-owned semantic colors under explicit theme selectors), and the legal pages' shell
- `src/scripts/main.ts`, canvas starfield, scramble-in headlines, scroll reveals, per-snippet terminal typing, and the hardcoded agent-sidebar prototype replay in the hero. The landing route starts it from an effect, and it owns that DOM outright afterwards
- `scripts/verify-build.test.ts`, Vitest contract tests for page metadata and every generated discovery asset

`vite.config.ts` lists every prerendered route. Add a route there when adding a page, otherwise the build will not emit it. The platform serves this website under its own origin through the rewrites in `platform/src/routes/-lib/website-rewrite.server.ts`, so add the page there too, and keep build assets under `/website-assets/`, the prefix it proxies.

Two caveats for the development server. Vite claims `.png` requests before Nitro sees them, so `/favicon.png` and `/og-image.png` answer 404 under `dev` while building them correctly. Nitro also registers its public output directory as a top-level asset root, so do not point `output.publicDir` back inside the project: every path the last build wrote a file for would then fail under `dev`.

All animation respects `prefers-reduced-motion`. Fonts are self-hosted via @fontsource (Anton / Space Grotesk / JetBrains Mono).

## Hosted domain redirects

[`Caddyfile`](Caddyfile) contains the production `astralbeam.ai` and `www.astralbeam.ai` site blocks and requires [Caddy 2.8 or newer](https://github.com/caddyserver/caddy/releases/tag/v2.8.0) for `uri query`. Replace those two blocks in the server's existing Caddy configuration, preserve its other hosts, validate the complete configuration with the installed Caddy, then reload it. The website's Cloudflare deploy does not apply this server configuration.

The domain migration reversed a permanent `astralbeam.ai` to `www.astralbeam.ai` redirect. Browsers that cached the old redirect loop when `www` sends them back to the same apex URL. The replacement uses a non-cacheable temporary redirect with `_redirect_recovery=1`, preserving the path and other query parameters. On the apex response, [`Clear-Site-Data: "cache"`](https://www.w3.org/TR/clear-site-data/#clear-cache) removes the old cached redirect in supporting browsers while preserving cookies and local storage. Ordinary responses do not clear caches.

If both directions are already cached, the browser cannot reach the changed server rule. After reloading Caddy, open [the recovery URL](https://astralbeam.ai/?_redirect_recovery=1) once, then try the bare homepage again. Browsers that do not support cache clearing through this header need their cached files cleared manually. Validate in a previously affected browser as well as a private window, since a fresh browser alone misses this regression.

## License

Except for third-party material, files in this project are licensed under the [MIT License](../LICENSE-MIT). See [third-party notices](../docs/legal/THIRD_PARTY_NOTICES.md) for bundled fonts.
