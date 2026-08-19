# AstralBeam development

## Tooling and validation

- `webapp`, `www`, and `sdk` are independent Deno projects with their own `package.json`, `deno.lock`, and `node_modules`. There is no repository-level package manager, workspace, or task runner, so run every command from inside the application directory with `deno task <script>`.
- All three projects expose `check` (type diagnostics), `test`, and `build`. Add dependencies with `deno add npm:<package>` and install from a lockfile with `deno install --frozen`.
- Run `./scripts/setup.sh` once after pulling. Otherwise, use the smallest relevant application task or syntax/configuration check; documentation and instruction changes need only source review and `git diff --check`.
- Do not automatically run `check`, `test`, or `build`. Run the affected application's tasks once before creating a PR or when explicitly requested, and only separately when diagnosing a failure.
- Formatting and linting are not enforced by tooling; match the surrounding style, which omits semicolons.

## Documentation

- Use `README.md` for consumers and `AGENTS.md` for authors. When creating an `AGENTS.md`, add a sibling `CLAUDE.md` symlink to it.
- Name planning documents with the `*.plan.md` suffix so they are distinguishable from durable documentation.
- Keep each Markdown paragraph and list item on one source line.
- Comment only non-obvious code or configuration decisions, including a link to authoritative documentation or an issue.

## Environment

- Keep environment files at the repository root. Commit only reviewed non-secret templates and defaults (`.env.example`, `.env.development`, and its `.env.test` symlink); never commit credentials or deployment-specific values.
- Load root environment files through each application's build configuration (`envDir` in `www/astro.config.ts`) instead of adding additional loaders or package-local environment files. Shell, CI, and deployment variables must take precedence over file values.

## Webapp UI

- `webapp` owns the repository's only `components.json` and all shadcn-generated components, hooks, and utilities.
- Add components with `deno task ui add <component>` from `webapp`.

## Database

- Keep PostgreSQL and Drizzle code in server-only modules under `webapp/src` and never re-export the runtime client through a client-reachable module.
- Run database commands with `deno task db <command>` from `webapp`.
- After schema changes, run `db generate --name <description>`, inspect the SQL, run `db check`, and commit schema and migration files together.
- Use `db migrate` for checked-in migrations; reserve `db push --explain` for local prototypes. Use the provided `DATABASE_URL` and never commit credentials or package-local environment files.

## Cursor Cloud

- For UI changes, verify the affected flow through browser computer use and attach a screenshot or video artifact.
