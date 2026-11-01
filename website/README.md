# @astralbeam/website

TanStack Start, React, and CSS, managed with Bun. All routes are prerendered to `.output/public/` for static hosting. See [repository setup](../SETUP.md) for dependencies.

Run common commands from the repository root:

```sh
bun run --cwd website dev      # development server on 4600
bun run --cwd website build    # static output in .output/public/
bun run --cwd website preview  # production preview on 4620
bun run --cwd website generate:blog-images # refresh optimized PNGs from blog SVGs
bun run --cwd website ready    # check, build, then test
bun run --cwd website deploy   # ready, then deploy to Cloudflare
```

`ready` builds before testing because the tests inspect `.output/public/`. Use `deploy` only when publishing the website is intended.

GitHub CI uploads website source maps directly to PostHog after the website checks pass on pushes to `main`, using the repository's `POSTHOG_API_KEY` secret and `POSTHOG_PROJECT_ID` variable, plus optional `POSTHOG_HOST`. Build the deployed website from the same commit, locked dependencies, Bun version, and build settings so its debug IDs match. Generation needs no credentials, and maps remain outside served assets and GitHub artifact storage.

For optional <a href="https://developers.cloudflare.com/workers/ci-cd/builds/configuration/" target="_blank" rel="noopener noreferrer">Cloudflare Workers Builds</a> deployments, keep the root directory at `website`, set `BUN_VERSION` to the version in the repository’s `.bun-version`, and use `bun install --frozen-lockfile && bun run build` as the build command. Bun installs the parent workspace. Use `bun run wrangler deploy` for production and `bun run wrangler versions upload` for preview branches. These dashboard settings are separate from `wrangler.json` and must be updated when changing build runtimes.

Routes live in `src/routes/`, landing content in `src/routes/-landing/`, and styles in `src/styles/`.

`vite.config.ts` lists fixed prerendered routes and discovers blog routes from Markdown filenames. Add other new routes there, otherwise the build will not emit them. The platform serves this website under its own origin through the rewrites in `platform/src/routes/-lib/website-rewrite.server.ts`, so add other new public paths there too, and keep build assets under `/website-assets/`, the prefix it proxies. The `/blog/` prefix includes posts, the feed, and blog images.

Production caching follows `public/_headers`: hashed build assets stay fresh for one year, and explicitly listed public files for five minutes. Add an exact path entry for each new public file that needs this policy. Stable files revalidate after expiry. HTML revalidates on each visit. Platform preserves these headers through the rewrite, prevents caching upstream errors, and keeps `/` private and revalidated because sign-in changes it to the dashboard.

The Website links in docs and the platform's profile menu always open `https://astralbeam.ai/home` directly, including on self-hosted deployments without `website_url`.

The build publishes the [AstralBeam skill](../skills/astralbeam/SKILL.md) and its discovery index from this single source.

Blog articles live in `src/content/blog/*.md`. Edit the prose and YAML front matter in the same file. The filename becomes `/blog/<filename>`, and `title`, `description`, quoted ISO `date`, `author`, `image`, and `imageAlt` supply the listing, search metadata, and RSS feed. New Markdown files enter the index, sitemap, feed, and static build automatically. The image field names a 1200 × 630 PNG, with a matching SVG used on the page. Keep both under `public/blog/images/`. The blog uses Source Serif 4 headlines and system body fonts.

Fenced blocks with the language `demo` embed the interactive example named inside, such as `retry`. The available examples are in `src/routes/blog/-components/failure-demo.tsx`. Normal Markdown handles the rest of the article. These examples run entirely in the browser with synthetic data and no model calls. Keep each example's explanation in the Markdown so the article remains useful without JavaScript.

Two caveats for the development server. Vite claims `.png` requests before Nitro sees them, so `/favicon.png` and `/og-image.png` answer 404 under `dev` while building them correctly. Nitro also registers its public output directory as a top-level asset root, so do not point `output.publicDir` back inside the project: every path the last build wrote a file for would then fail under `dev`.

All animation respects `prefers-reduced-motion`. Fonts are self-hosted via @fontsource (Anton / Space Grotesk / JetBrains Mono / Source Serif 4).

## Analytics

`src/lib/analytics.ts` initializes the `posthog-js` SDK only on `https://astralbeam.ai`. The website and platform import it from TanStack Start's `src/client.tsx`, covering the website, blog, docs, API reference, and dashboard through their normal Vite builds. Both clients expose the SDK through `@posthog/react`’s `PostHogProvider`. It captures page views, interactions, web vitals, and session replays with ordinary text, conversations, and rendering attributes visible. Ordinary form values remain visible, while SDK password masking and field-specific credential blocks remain enabled. Event and replay URLs retain query strings, fragments, organization slugs, and resource IDs, with credentials, authentication tokens, OAuth codes, and signed URL credentials redacted. Person profiles, page titles, campaign and referrer attribution, performance capture, and replay console logs use SDK and project defaults. Redaction is limited to extremely sensitive values such as passwords, credentials, authentication tokens, and explicitly marked elements. Ordinary chat content, names, email addresses, and organization data remain capturable. Network headers follow project settings, which default to off. Request and response bodies are excluded because operator sign-in and configuration reveals carry opaque credentials under generic field names or as raw strings. PostHog's native scrubber runs first, then `before_send` adds credential redaction to remaining fields and URLs. The project token is public browser configuration. Local development, previews on other origins, and self-hosted installations do not send analytics. Future client instrumentation can import the initialized `posthog-js` singleton. Server tracing needs its own integration.

Events and replay bundles use PostHog's managed proxy at `https://e.astralbeam.ai`, with `ui_host` kept at `https://us.posthog.com` for dashboard links. Keep the `e` CNAME pointed at the target shown in PostHog's organization proxy settings, with Cloudflare proxying disabled (DNS only), so PostHog can provision and renew HTTPS. The website CSP permits the proxy for scripts and connections. On website pages, the optional toolbar's direct PostHog requests require a browser-local CSP override. Both website and platform builds must be deployed to change their shared SDK configuration. See the <a href="https://posthog.com/docs/advanced/proxy" target="_blank" rel="noopener noreferrer">managed proxy setup and troubleshooting guide</a>.

The platform identifies logged-in organization users from its existing Better Auth session using their immutable user ID, with name and email as person properties. The dashboard's resolved organization adds `organization_id` and `organization_name` to events and an `organization` group keyed by its immutable ID, with its name as a group property. The same-origin PostHog identity and most recent organization persist across the website and blog. Their header and the docs header share `src/lib/use-is-signed-in.ts`, which checks `/api/auth/get-session` after the browser's `load` event without caching the response and replaces header sign-in/sign-up actions with one primary Dashboard button for signed-in visitors. Prerendered HTML stays generic and suitable for CDN caching. This check does not update analytics identity. Signing out, session expiration, or switching accounts resets the previous identity once the platform session resolves. Session loading and temporary authentication errors do not reset anonymous attribution. Group-level reports require PostHog's separately enabled group analytics add-on.

Both client entries capture React errors and propagate session headers. See the [PostHog configuration guide](../platform/src/routes/docs/-content/self-hosting/configuration.md#posthog-errors-and-ai-observability) for source-map uploads and backend setup.

### PostHog element controls

Use these controls only on specifically identified sensitive elements. Do not mask or exclude an entire conversation or panel merely because it contains user content. PostHog documents <a href="https://posthog.com/docs/session-replay/privacy" target="_blank" rel="noopener noreferrer">replay privacy</a>, <a href="https://posthog.com/docs/libraries/js/usage#session-replay" target="_blank" rel="noopener noreferrer">replay class defaults</a>, and <a href="https://posthog.com/docs/product-analytics/autocapture" target="_blank" rel="noopener noreferrer">autocapture controls</a>.

| Class or attribute | Effect |
| --- | --- |
| `ph-mask` | Selects replay text for masking while preserving layout. A custom `maskTextFn` supplies the replacement instead of the SDK's default asterisks. |
| `ph-no-capture` | Replaces the replay subtree with a placeholder of the same size and prevents its interaction autocapture. |
| `ph-ignore-input` | Ignores replay input-change events. Does not remove the initial DOM value, so it is insufficient for protecting credentials. |
| `ph-no-autocapture` or `data-ph-no-autocapture` | Excludes the subtree from interaction autocapture. Does not mask replay. |
| `ph-sensitive` | Treats element text and attributes as sensitive for autocapture. Does not itself mask replay. |
| `ph-include` | Opts an element into autocapture eligibility checks. Does not override blocked ancestors or unmask replay. |
| `ph-no-rageclick` | Excludes the element from rage-click detection. Other capture continues. |
| `ph-no-deadclick` | Excludes the element from dead-click events. Ordinary autocapture, replay, and heatmaps continue. |

Our `maskTextFn` preserves ordinary text and redacts recognized credentials, so `ph-mask` does not blanket-mask arbitrary content here. Use `ph-no-capture` on an actual credential field when its entire replay value must be excluded. The last two classes filter diagnostic signals, not sensitive data. `ph-sensitive` and `ph-include` are SDK-level controls, verified in the <a href="https://github.com/PostHog/posthog-js/blob/main/packages/browser-common/src/utils/autocapture-utils.ts" target="_blank" rel="noopener noreferrer">autocapture implementation</a>. Custom ignore lists replace SDK defaults. These markers do not sanitize URLs, network payloads, or manually captured events. Keep credential redaction at those boundaries.

## License

[MIT](../LICENSE-MIT), except third-party material. See [third-party notices](../docs/legal/THIRD_PARTY_NOTICES.md) for bundled fonts.
