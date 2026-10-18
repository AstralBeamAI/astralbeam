# @astralbeam/www

TanStack Start, React, and CSS, managed with Bun. All routes are prerendered to `.output/public/` for static hosting.

Run common commands from the repository root:

```sh
bun run --cwd www dev      # development server on 4600
bun run --cwd www build    # static output in .output/public/
bun run --cwd www preview  # production preview on 4001
bun run --cwd www generate:blog-images # refresh optimized PNGs from blog SVGs
bun run --cwd www ready    # check, build, then test
bun run --cwd www deploy   # ready, then deploy to Cloudflare
```

`ready` builds before testing because the tests inspect `.output/public/`. Use `deploy` only when publishing the website is intended.

For [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), keep the root directory at `www`, set `BUN_VERSION` to the version in the repository’s `.bun-version`, and use `bun install --frozen-lockfile && bun run build` as the build command. Bun installs the parent workspace. Use `bun run wrangler deploy` for production and `bun run wrangler versions upload` for preview branches. These dashboard settings are separate from `wrangler.json` and must be updated when changing build runtimes.

Structure:

- Routes live in `src/routes/`, landing content in `src/routes/-landing/`, and styles in `src/styles/`.

`vite.config.ts` lists fixed prerendered routes and discovers blog routes from Markdown filenames. Add other new routes there, otherwise the build will not emit them. The platform serves this website under its own origin through the rewrites in `platform/src/routes/-lib/website-rewrite.server.ts`, so add other new public paths there too, and keep build assets under `/website-assets/`, the prefix it proxies. The `/blog/` prefix includes posts, the feed, and blog images.

Browser caching follows `public/_headers`: hashed build assets stay fresh for one year, stable images and demo downloads for one hour, and discovery files and the feed for five minutes. Stable files revalidate after expiry, so an unchanged URL can retain its previous content for that freshness window. HTML revalidates on each visit to pick up deployment changes. Platform preserves these headers through the rewrite, prevents caching upstream errors, and keeps `/` private and revalidated because sign-in changes it to the dashboard.

Blog articles live in `src/content/blog/*.md`. Edit the prose and YAML front matter in the same file. The filename becomes `/blog/<filename>`, and `title`, `description`, quoted ISO `date`, `author`, `image`, and `imageAlt` supply the listing, search metadata, and RSS feed. New Markdown files enter the index, sitemap, feed, and static build automatically. The image field names a 1200 × 630 PNG, with a matching SVG used on the page. Keep both under `public/blog/images/`. The blog uses Source Serif 4 headlines and system body fonts.

Fenced blocks with the language `demo` embed the interactive example named inside, such as `retry`. The available examples are in `src/routes/blog/-components/failure-demo.tsx`. Normal Markdown handles the rest of the article. These examples run entirely in the browser with synthetic data and no model calls. Keep each example's explanation in the Markdown so the article remains useful without JavaScript.

Two caveats for the development server. Vite claims `.png` requests before Nitro sees them, so `/favicon.png` and `/og-image.png` answer 404 under `dev` while building them correctly. Nitro also registers its public output directory as a top-level asset root, so do not point `output.publicDir` back inside the project: every path the last build wrote a file for would then fail under `dev`.

All animation respects `prefers-reduced-motion`. Fonts are self-hosted via @fontsource (Anton / Space Grotesk / JetBrains Mono / Source Serif 4).

`src/lib/analytics.ts` initializes the `posthog-js` SDK only on `https://astralbeam.ai`. The website and platform import it from TanStack Start's `src/client.tsx`, covering the website, blog, docs, API reference, and dashboard through their normal Vite builds. The platform exposes the SDK through `@posthog/react`’s `PostHogProvider`. It captures page views, interactions, web vitals, and masked session replays. Event and replay URLs retain query strings, fragments, organization slugs, and resource IDs, including authentication token values. Person profiles, page titles, campaign and referrer attribution, performance capture, and replay console logs use SDK and project defaults. Text, inputs, and element attributes are masked. Network bodies and headers are excluded. The project token is public browser configuration. Local development, previews on other origins, and self-hosted installations do not send analytics. Future client instrumentation can import the initialized `posthog-js` singleton. Server tracing needs its own integration.

The platform identifies logged-in organization users from its existing Better Auth session using their immutable user ID, with name and email as person properties. The dashboard's resolved organization adds `organization_id` and `organization_name` to events and an `organization` group keyed by its immutable ID, with its name as a group property. The same-origin PostHog identity and most recent organization persist across the website and blog, which do not fetch authentication sessions. Signing out, session expiration, or switching accounts resets the previous identity once the platform session resolves. Session loading and temporary authentication errors do not reset anonymous attribution. Group-level reports require PostHog's separately enabled group analytics add-on.

## Hosted domain redirects

[Caddyfile](Caddyfile) configures the hosted domains separately from Cloudflare deployment and requires Caddy 2.8+. Preserve other hosts, validate the full configuration, then reload. Its permanent redirects preserve paths and queries from the legacy hosts. The legacy app host still proxies `/api*` to the platform, and the play host still proxies the example app. The www redirect retains the recovery parameter to bypass previously cached apex-to-www redirects without clearing sessions. The apex compresses public website, documentation, discovery, and asset responses with Zstandard or gzip. Platform also precompresses its static assets with Brotli, Zstandard, and gzip, including in standalone binaries. Caddy preserves those encoded responses. Chat streams and authenticated API responses remain outside the proxy compression matcher. If a browser still loops, open [the recovery URL](https://astralbeam.ai/?_redirect_recovery=1) once or clear its cached files. Verify in a previously affected browser as well as a private window.

## License

[MIT](../LICENSE-MIT), except third-party material. See [third-party notices](../docs/legal/THIRD_PARTY_NOTICES.md) for bundled fonts.
