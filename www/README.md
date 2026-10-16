# AstralBeam website

TanStack Start, React, and CSS, managed with Bun. All routes are prerendered to `.output/public/` for static hosting.

Run from the repository root:

```sh
bun run --cwd www dev      # development server on 4600
bun run --cwd www build    # static output in .output/public/
bun run --cwd www preview  # production preview on 4001
bun run --cwd www generate:blog-images # refresh optimized PNGs from blog SVGs
bun run --cwd www ready    # check, build, then test
bun run --cwd www deploy   # ready, then deploy to Cloudflare
```

Tests inspect the build output, so `ready` builds first. See [contributor setup](../SETUP.md) for dependencies.

## Editing

- Routes live in `src/routes/`, landing content in `src/routes/-landing/`, and styles in `src/styles/`.
- Add public routes to `vite.config.ts` and the platform's `src/routes/-lib/website-rewrite.server.ts`. Keep build assets under `/website-assets/` for the platform proxy.
- Blog posts live in `src/content/blog/*.md` and are discovered automatically. Match an existing post's front matter. Keep its 1200 × 630 PNG and matching SVG under `public/blog/images/`. Fenced `demo` blocks select examples from `src/routes/blog/-components/failure-demo.tsx`.

Under `dev`, generated `/favicon.png` and `/og-image.png` return 404. Verify them with a production build. Keep Nitro's public output outside the project to avoid development asset collisions.

## Analytics

`src/lib/analytics.ts` initializes PostHog through both apps' client entries, only on `https://astralbeam.ai`. Full URLs are captured with authentication tokens redacted. Replay text, inputs, and attributes are masked, and network headers and bodies are excluded. Other settings use SDK/project defaults.

The platform identifies Better Auth users and their organization. The website shares that browser identity without fetching sessions. See the [privacy disclosure](src/routes/privacy.tsx) for collected data.

## Deployment

For Cloudflare Workers Builds, use root `www`, `BUN_VERSION` from `.bun-version`, build command `bun install --frozen-lockfile && bun run build`, production command `bun run wrangler deploy`, and preview command `bun run wrangler versions upload`.

## Hosted domain redirects

[Caddyfile](Caddyfile) configures the hosted domains separately from Cloudflare deployment and requires Caddy 2.8+. Preserve other hosts, validate the full configuration, then reload. Its temporary redirect repairs previously cached apex-to-www redirects without clearing sessions. If a browser still loops, open [the recovery URL](https://astralbeam.ai/?_redirect_recovery=1) once or clear its cached files. Verify in a previously affected browser as well as a private window.

## License

[MIT](../LICENSE-MIT), except third-party material. See [third-party notices](../docs/legal/THIRD_PARTY_NOTICES.md) for bundled fonts.
