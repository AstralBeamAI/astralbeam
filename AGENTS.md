# AstralBeam development

## Tooling and validation

- Use Deno from the affected project directory (`webapp`, `www`, `sdk`, or `examples/todos`) with `deno task <script>`; the projects do not form a package-manager workspace. Deno is the only supported JavaScript runtime and package manager, while Vite and specialized npm packages run through Deno's compatibility layer.
- Before running `deno task knip:fix`, commit or back up untracked work because it can delete unused files that Git cannot restore; then inspect the complete project diff before running `deno task check:fix`.
- Protect intentionally reusable, unreferenced modules with explicit Knip entries rather than broad directory exclusions; verify `knip:fix` preserves them.
- Run `scripts/setup.sh` once after pulling to install the OS-level tooling and the projects' frozen dependencies. Otherwise, use the smallest relevant project task or syntax/configuration check; documentation and instruction changes need only source review and `git diff --check`.
- Do not automatically run `deno task check`, `deno task test`, or `deno task ready`. `ready` already runs checks, tests, and builds; run it once before creating a PR or when explicitly requested, without separate `check` or `test` runs unless diagnosing a failure.
- Always write and run JavaScript and TypeScript tests with Vitest through the project's Deno task; never use `Deno.test` or `deno test`.
- Keep tests that protect durable behavior, security boundaries, or previously observed regressions; avoid tests that only restate implementation details or exercise trivial constants and generated structure.
- Before final validation, turn durable, non-obvious user corrections into one concise, nonduplicative instruction in the closest `AGENTS.md` or skill; skip one-off decisions and preferences.

## Documentation

- Use `README.md` for consumers and `AGENTS.md` for authors. When creating an `AGENTS.md`, add a sibling `CLAUDE.md` symlink to it.
- Preserve existing `AGENTS.md` and skill instructions unless removal is explicit or resolves a documented conflict.
- Name planning documents with the `*.plan.md` suffix so they are distinguishable from durable documentation.
- Keep each Markdown paragraph and list item on one source line.
- Comment only non-obvious code or configuration decisions, including a link to authoritative documentation or an issue.

## Environment

- Keep Webapp environment files under `webapp`. `.env.development` is the single committed env file and holds only the local `DATABASE_URL` default; TanStack Start loads it without overriding an existing shell, CI, or deployment value. Ignore `*.local` files and never commit credentials or deployment-specific values.
- The webapp reads only `DATABASE_URL` from the environment; every other runtime setting lives in its database `config` table and is managed at `/configure` (see `webapp/AGENTS.md`). Keep standalone tool loading local to the tool configuration, with shell, CI, and deployment variables taking precedence over file values.
- Never install PostgreSQL or Valkey from `scripts/setup.sh` on macOS; start its Podman services through the Docker-compatible `docker compose` command when available unless `SKIP_DOCKER_COMPOSE=true` is set. In Codex Cloud's Ubuntu environment, keep setup and maintenance behavior in the repository scripts and invoke `scripts/codex-db.sh` only through `INSTALL_EXTRA=codex-db`, paired with `SKIP_DOCKER_COMPOSE=true`; the helper extracts the official PGDG PostgreSQL binaries without installing `postgresql-common`, while setup installs only webapp dependencies, fails network operations without retries, then starts the host databases and migrates the webapp.

## Webapp and SDK UI

- `webapp` and `sdk` each own a `components.json` and their own shadcn-generated components, hooks, and utilities under that project's `src/components/ui`, `src/hooks`, and `src/lib`; neither imports the other's.
- Add components from the owning project with `deno task ui add <component>`. Both `components.json` files use the phosphor icon library, but their styles diverge on purpose: the webapp uses `base-lyra`/`mist`, while the SDK stays on the plain `b0` preset baseline (`base-nova`/`neutral`).
- At the top of each registry-added `src/components/ui` file, record the repeatable command as `// Added with: deno task ui add <component>` and every intentional local change; omit nonessential automation flags such as `--overwrite` and `-y` from the recorded command.
- Let Knip remove unreachable registry files under `src/components/ui`; ignore generated export-level noise rather than excluding the directory from unused-file discovery.
- Use `@phosphor-icons/react` throughout Webapp and SDK UI; replace other icon-library imports in registry source during integration and do not add `lucide-react` as a dependency.
- Keep the hand-authored portions of `webapp/src/styles.css` theme-agnostic; concrete palette values belong only in its marked generated section. The theme blocks in `sdk/src/styles.css` are the chat widget's own palette, deliberately independent of the webapp's; edit them directly and do not resynchronize them with `brand.json`.

## Theme and brand

- Keep the pure semantic theme compiler in `webapp/src/theme/theme.ts`; it must not perform filesystem, HTTP, DOM, environment, or mutable global-state work.
- Treat `webapp/src/theme/brand.json` as the concrete theme source of truth and keep the marked theme section in `webapp/src/styles.css` synchronized through explicit edits.
- Keep `webapp/src/theme/theme.schema.json`, the runtime contract, and the independently published `www/src/brand/theme.schema.json` snapshot synchronized through explicit edits; neither project may import the other.
- Keep SVG logo masters and their generated PNG variants under `webapp/public` and regenerate the PNGs from `webapp` with `deno task generate:png` after SVG changes.

## Database

- Keep PostgreSQL and Drizzle code under `webapp/src/db`; use the `.server.ts` suffix for server-only modules and never import the runtime client into browser code.
- Keep domain table and relation modules under `webapp/src/db/schema`, re-export every module Drizzle Kit must discover from `webapp/src/db/schema.server.ts`, and keep generated migrations under `webapp/src/db/migrations`.
- Run database commands from `webapp` with `deno task db <command>`.
- After schema changes, run `generate --name <description>`, inspect the SQL, run `check`, and commit schema and migration files together.
- Use PostgreSQL `uuid` primary and foreign keys with database-generated `uuidv7()` defaults, `citext` for email identity, and `timestamp with time zone` without forced precision for application instants; PostgreSQL 18 is the minimum supported server version.
- Define tables with `snakeCase.table`, keep TypeScript property names camel case, and omit redundant column-name arguments when Drizzle can derive the lower snake-case SQL name.
- Keep required extension DDL such as `CREATE EXTENSION IF NOT EXISTS citext` in the generated migration because a Drizzle `customType` does not install its PostgreSQL extension. Regenerate an unmerged, unapplied migration when refining the same schema change, but never rewrite migration history that may have been applied by others.
- Follow the applicable PostgreSQL [Don't Do This](https://wiki.postgresql.org/wiki/Don't_Do_This) guidance: keep identifiers lower snake case, use half-open timestamp ranges and `NOT EXISTS` where null-aware exclusion is needed, retain unconstrained `text`/`citext`, and avoid `timetz`, `CURRENT_TIME`, `char(n)`, default `varchar(n)`, `money`, `serial`, rules, table inheritance, and trust authentication over TCP/IP.
- Use `migrate` for checked-in migrations; reserve `push --explain` for local prototypes. Use the provided `DATABASE_URL` and never commit credentials or `*.local` environment files.

## Cursor Cloud

- For UI changes, verify the affected flow through browser computer use and attach a screenshot or video artifact.
