# AstralBeam

Two independent Deno applications: a TanStack Start product application with app-local shadcn/ui components, and the public Astro website.

```text
webapp/       # TanStack Start application, database, theme, and UI
www/          # Public website
```

Each application owns its own `package.json`, `deno.lock`, and `node_modules`; there is no repository-level package manager, workspace, or task runner. Run every command from inside the application directory with `deno task <script>`.

## Local development

Choose either the included devcontainer or the direct macOS workflow. Follow [`SETUP.md`](SETUP.md) for prerequisites and the PostgreSQL and Valkey service lifecycle.

```sh
./scripts/setup.sh          # Install Deno and both applications' dependencies
cd webapp && deno task dev  # Starts app on http://localhost:3000
cd www && deno task dev     # Starts website on http://localhost:3001
```

Environment files live at the repository root. The website loads them through the `envDir` setting in [`www/astro.config.ts`](www/astro.config.ts). Optional overrides are documented in `.env.example`, local service defaults live in `.env.development`, and secrets belong in the ignored `.env.local`. Keep secrets unprefixed for server-only `process.env` access; only variables intentionally exposed to browsers may use an application's public prefix (`VITE_` for the TanStack Start app and `PUBLIC_` for Astro). Deployment environments must inject secrets at runtime rather than relying on checked-out environment files.

Add shadcn components from the webapp directory:

```sh
cd webapp && deno task ui add button
```

## Validate and build

Both applications expose the same three task names, so run each from its own directory:

```sh
cd webapp && deno task check  # TypeScript diagnostics (tsc)
cd webapp && deno task test   # Vitest
cd webapp && deno task build  # Production build
```

```sh
cd www && deno task check   # Astro diagnostics
cd www && deno task test    # Production build and generated-output verification
cd www && deno task build   # Static build to www/dist/
```

## Licensing

Portions of this repository are licensed as follows:

- Files under [`www`](www) are licensed under the [MIT License](LICENSE-MIT), except for third-party material governed by its applicable license.
- All other files in this repository are licensed under the [GNU Affero General Public License v3.0 only](LICENSE-AGPL) (`AGPL-3.0-only`), except where an adjacent license or notice states otherwise.
- Third-party components and materials are licensed under the applicable licenses provided by their respective owners. See [third-party notices](docs/legal/THIRD_PARTY_NOTICES.md).

Copyright © 2026 AstralBeam Inc. for AstralBeam-controlled material. Third-party material remains subject to its respective copyright and license terms.

## Tasks

- [ ] How to Create Server Routes
- [ ] Add Better Auth
- [ ] Add react-email
- [ ] Update to Latest TanStack Start API (if needed)
- [ ] Set up CLAUDE.md properly
- [ ] Claude Worktree Workflow (3 agents together)
- [ ] Explain recommended folder structure
- [ ] Example of how to use effect-ts
- [ ] Deployment on Cloud VM (Hetzner/AWS)
- [ ] how to set up middleware
