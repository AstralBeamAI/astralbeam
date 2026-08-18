# AstralBeam

A Vite+ monorepo with a TanStack Start application and app-local shadcn/ui components.

```text
apps/
  webapp/       @astralbeam/webapp  # TanStack Start application, database, theme, brand, and UI
  www/          @astralbeam/www     # Public website
```

## Local development

Choose either the included devcontainer or the direct macOS workflow. Follow [`SETUP.md`](SETUP.md) for prerequisites and the PostgreSQL and Valkey service lifecycle.

```sh
./scripts/setup.sh # Install dependencies
vp run webapp # Starts app on http://localhost:3000
vp run www # Starts website on http://localhost:3001
```

Applications and repository tools load environment files from the repository root through [`apps/webapp/config/workspace-environment.ts`](apps/webapp/config/workspace-environment.ts). Optional overrides are documented in `.env.example`, local service defaults live in `.env.development`, and secrets belong in the ignored `.env.local`. Keep secrets unprefixed for server-only `process.env` access; only variables intentionally exposed to browsers may use an application's public prefix (`VITE_` for the TanStack Start app and `PUBLIC_` for Astro). Deployment environments must inject secrets at runtime rather than relying on checked-out environment files.

Add shadcn components directly to the webapp:

```sh
vp run ui add button
```

## Validate and build

Use `vp run -r <script>` for tasks that must run in every workspace package. Before running `vp run knip:fix`, commit or back up untracked work because it can delete unused files that Git cannot restore; then review the resulting diff before running recursive Vite+ checks and fixes with `vp run -r check:fix`.

- Run formatting, linting, TypeScript, and unused-code checks:

  ```sh
  vp run check
  ```

- Run tests:

  ```sh
  vp run test
  ```

- Build the product application:

  ```sh
  vp run @astralbeam/webapp#build
  ```

## Licensing

Portions of this repository are licensed as follows:

- Files under [`apps/www`](apps/www) are licensed under the [MIT License](LICENSE-MIT), except for third-party material governed by its applicable license.
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
