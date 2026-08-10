# AstralBeam development

## Tooling and validation

- Use Vite+ from the repository root: `vp run <script>`, with `-r` only when every workspace package is intended. Docs are in `node_modules/vite-plus/docs` and at https://viteplus.dev/guide/.
- Before running `vp run knip:fix`, commit or back up untracked work because it can delete unused files that Git cannot restore; then inspect the complete diff before running recursive Vite+ checks and fixes with `vp run -r check:fix`.
- Run `vp install` once after pulling. Otherwise, use the smallest relevant package task or syntax/configuration check; documentation and instruction changes need only source review and `git diff --check`.
- Do not automatically run `vp run check`, `vp run test`, or `vp run ready`. `ready` already runs checks, tests, and builds; run it once before creating a PR or when explicitly requested, without separate `check` or `test` runs unless diagnosing a failure.
- Run `vp env doctor` only for setup, runtime, or package-manager problems.

## Documentation

- Use `README.md` for consumers and `AGENTS.md` for authors. When creating an `AGENTS.md`, add a sibling `CLAUDE.md` symlink to it.
- Keep each Markdown paragraph and list item on one source line.
- Comment only non-obvious code or configuration decisions, including a link to authoritative documentation or an issue.

## Shared UI

- `packages/ui` owns the monorepo's only `components.json` and all shadcn-generated components, hooks, and utilities; applications import them from `@astralbeam/ui`.
- Add components from the repository root with `vp run @astralbeam/ui#ui add <component>`.

## Database

- Keep PostgreSQL and Drizzle code in the server-only `packages/db` package and import it through `@astralbeam/db`.
- Run database commands from the repository root with `vp run @astralbeam/db#db <command>`.
- After schema changes, run `generate --name <description>`, inspect the SQL, run `check`, and commit schema and migration files together.
- Use `migrate` for checked-in migrations; reserve `push --explain` for local prototypes. Use the provided `DATABASE_URL` and never commit credentials or package-local environment files.

## Cursor Cloud

- For UI changes, verify the affected flow through browser computer use and attach a screenshot or video artifact.
