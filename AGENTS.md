# AstralBeam development

## Tooling and validation

- Use Deno from the affected project directory (`webapp`, `www`, or `sdk`) with `deno task <script>`; the projects do not form a package-manager workspace. Deno is the only supported JavaScript runtime and package manager, while Vite and specialized npm packages run through Deno's compatibility layer.
- Before running `deno task knip:fix`, commit or back up untracked work because it can delete unused files that Git cannot restore; then inspect the complete project diff before running `deno task check:fix`.
- Run `scripts/setup.sh` once after pulling to install the OS-level tooling and the projects' frozen dependencies. Otherwise, use the smallest relevant project task or syntax/configuration check; documentation and instruction changes need only source review and `git diff --check`.
- Do not automatically run `deno task check`, `deno task test`, or `deno task ready`. `ready` already runs checks, tests, and builds; run it once before creating a PR or when explicitly requested, without separate `check` or `test` runs unless diagnosing a failure.

## Documentation

- Use `README.md` for consumers and `AGENTS.md` for authors. When creating an `AGENTS.md`, add a sibling `CLAUDE.md` symlink to it.
- Name planning documents with the `*.plan.md` suffix so they are distinguishable from durable documentation.
- Keep each Markdown paragraph and list item on one source line.
- Comment only non-obvious code or configuration decisions, including a link to authoritative documentation or an issue.

## Environment

- Keep Webapp environment files under `webapp`. Commit reviewed non-secret environment files such as `.env`, `.env.development`, `.env.test`, and `.env.example`; ignore `*.local` files and never commit credentials or deployment-specific values.
- Let application runtime configuration use the framework's environment loading. Keep standalone tool loading local to the tool configuration, with shell, CI, and deployment variables taking precedence over file values.

## Webapp and SDK UI

- `webapp` and `sdk` each own a `components.json` and their own shadcn-generated components, hooks, and utilities under that project's `src/components/ui`, `src/hooks`, and `src/lib`; neither imports the other's.
- Add components from the owning project with `deno task ui add <component>`, keeping both `components.json` files on the same style, base color, and icon library.
- Keep the hand-authored portions of `webapp/src/styles.css` theme-agnostic; concrete palette values belong only in its marked generated section. The theme block in `sdk/src/styles.css` is a copy of the webapp light palette, kept in sync through explicit edits.

## Theme and brand

- Keep the pure semantic theme compiler in `webapp/src/theme/theme.ts`; it must not perform filesystem, HTTP, DOM, environment, or mutable global-state work.
- Treat `webapp/src/theme/brand.json` as the concrete theme source of truth and keep the marked theme section in `webapp/src/styles.css` synchronized through explicit edits.
- Keep `webapp/src/theme/theme.schema.json`, the runtime contract, and the independently published `www/src/brand/theme.schema.json` snapshot synchronized through explicit edits; neither project may import the other.
- Keep SVG logo masters and their generated PNG variants under `webapp/public` and regenerate the PNGs from `webapp` with `deno task generate:png` after SVG changes.

## Database

- Keep PostgreSQL and Drizzle code under `webapp/src/db`; use the `.server.ts` suffix for server-only modules and never import the runtime client into browser code.
- Re-export every table and relation Drizzle Kit must discover from `webapp/src/db/schema.server.ts`, and keep generated migrations under `webapp/src/db/migrations`.
- Run database commands from `webapp` with `deno task db <command>`.
- After schema changes, run `generate --name <description>`, inspect the SQL, run `check`, and commit schema and migration files together.
- Use `migrate` for checked-in migrations; reserve `push --explain` for local prototypes. Use the provided `DATABASE_URL` and never commit credentials or `*.local` environment files.

## Cursor Cloud

- For UI changes, verify the affected flow through browser computer use and attach a screenshot or video artifact.
