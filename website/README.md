# @astralbeam/website

TanStack Start, React, and CSS, managed with Bun. All routes are prerendered to `.output/public/` for static hosting. See [repository setup](../SETUP.md) for dependencies.

Run common commands from the repository root:

```sh
bun run --cwd website dev      # development server on 4600
bun run --cwd website build    # static output in .output/public/
bun run --cwd website preview  # production preview on 4001
bun run --cwd website generate:blog-images # refresh optimized PNGs from blog SVGs
bun run --cwd website ready    # check, build, then test
bun run --cwd website deploy   # ready, then deploy to Cloudflare
```

`ready` builds before testing because the tests inspect `.output/public/`. Use `deploy` only when publishing the website is intended.

For <a href="https://developers.cloudflare.com/workers/ci-cd/builds/configuration/" target="_blank" rel="noopener noreferrer">Cloudflare Workers Builds</a>, keep the root directory at `website`, set `BUN_VERSION` to the version in the repository’s `.bun-version`, and use `bun install --frozen-lockfile && bun run build` as the build command. Bun installs the parent workspace. Use `bun run wrangler deploy` for production and `bun run wrangler versions upload` for preview branches. These dashboard settings are separate from `wrangler.json` and must be updated when changing build runtimes.

Routes live in `src/routes/`, landing content in `src/routes/-landing/`, and styles in `src/styles/`.

`vite.config.ts` lists fixed prerendered routes and discovers blog routes from Markdown filenames. Add other new routes there, otherwise the build will not emit them. The platform serves this website under its own origin through the rewrites in `platform/src/routes/-lib/website-rewrite.server.ts`, so add other new public paths there too, and keep build assets under `/website-assets/`, the prefix it proxies. The `/blog/` prefix includes posts, the feed, and blog images.

Production caching follows `public/_headers`: hashed build assets stay fresh for one year, and explicitly listed public files for five minutes. Add an exact path entry for each new public file that needs this policy. Stable files revalidate after expiry. HTML revalidates on each visit. Platform preserves these headers through the rewrite, prevents caching upstream errors, and keeps `/` private and revalidated because sign-in changes it to the dashboard.

The build publishes the [CLI skill](../cli/skills/astralbeam/SKILL.md) and its discovery index from this single source.

Blog articles live in `src/content/blog/*.md`. Edit the prose and YAML front matter in the same file. The filename becomes `/blog/<filename>`, and `title`, `description`, quoted ISO `date`, `author`, `image`, and `imageAlt` supply the listing, search metadata, and RSS feed. New Markdown files enter the index, sitemap, feed, and static build automatically. The image field names a 1200 × 630 PNG, with a matching SVG used on the page. Keep both under `public/blog/images/`. The blog uses Source Serif 4 headlines and system body fonts.

Fenced blocks with the language `demo` embed the interactive example named inside, such as `retry`. The available examples are in `src/routes/blog/-components/failure-demo.tsx`. Normal Markdown handles the rest of the article. These examples run entirely in the browser with synthetic data and no model calls. Keep each example's explanation in the Markdown so the article remains useful without JavaScript.

Two caveats for the development server. Vite claims `.png` requests before Nitro sees them, so `/favicon.png` and `/og-image.png` answer 404 under `dev` while building them correctly. Nitro also registers its public output directory as a top-level asset root, so do not point `output.publicDir` back inside the project: every path the last build wrote a file for would then fail under `dev`.

All animation respects `prefers-reduced-motion`. Fonts are self-hosted via @fontsource (Anton / Space Grotesk / JetBrains Mono / Source Serif 4).

`src/lib/analytics.ts` initializes the `posthog-js` SDK only on `https://astralbeam.ai`. The website and platform import it from TanStack Start's `src/client.tsx`, covering the website, blog, docs, API reference, and dashboard through their normal Vite builds. Both clients expose the SDK through `@posthog/react`’s `PostHogProvider`. It captures page views, interactions, web vitals, and masked session replays. Event and replay URLs retain query strings, fragments, organization slugs, and resource IDs, including authentication token values. Person profiles, page titles, campaign and referrer attribution, performance capture, and replay console logs use SDK and project defaults. Text, inputs, and element attributes are masked. Network bodies and headers are excluded. The project token is public browser configuration. Local development, previews on other origins, and self-hosted installations do not send analytics. Future client instrumentation can import the initialized `posthog-js` singleton. Server tracing needs its own integration.

The platform identifies logged-in organization users from its existing Better Auth session using their immutable user ID, with name and email as person properties. The dashboard's resolved organization adds `organization_id` and `organization_name` to events and an `organization` group keyed by its immutable ID, with its name as a group property. The same-origin PostHog identity and most recent organization persist across the website and blog. Their header and the docs header share `src/lib/use-is-signed-in.ts`, which checks `/api/auth/get-session` after the browser's `load` event without caching the response and replaces header sign-in/sign-up actions with one primary Dashboard button for signed-in visitors. Prerendered HTML stays generic and suitable for CDN caching. This check does not update analytics identity. Signing out, session expiration, or switching accounts resets the previous identity once the platform session resolves. Session loading and temporary authentication errors do not reset anonymous attribution. Group-level reports require PostHog's separately enabled group analytics add-on.

## License

[MIT](../LICENSE-MIT), except third-party material. See [third-party notices](../docs/legal/THIRD_PARTY_NOTICES.md) for bundled fonts.
