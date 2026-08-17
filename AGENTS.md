# AstralBeam development

## Tooling and validation

- Use Vite+ from the repository root: `vp run <script>`, with `-r` only when every workspace package is intended. Docs are in `node_modules/vite-plus/docs` and at <https://viteplus.dev/guide/>.
- Before running `vp run knip:fix`, commit or back up untracked work because it can delete unused files that Git cannot restore; then inspect the complete diff before running recursive Vite+ checks and fixes with `vp run -r check:fix`.
- Run `./scripts/setup.sh` once after pulling. Otherwise, use the smallest relevant package task or syntax/configuration check; documentation and instruction changes need only source review and `git diff --check`.
- Do not automatically run `vp run check`, `vp run test`, or `vp run ready`. `ready` already runs checks, tests, and builds; run it once before creating a PR or when explicitly requested, without separate `check` or `test` runs unless diagnosing a failure.
- Run `vp env doctor` only for setup, runtime, or package-manager problems.

## Documentation

- Use `README.md` for consumers and `AGENTS.md` for authors. When creating an `AGENTS.md`, add a sibling `CLAUDE.md` symlink to it.
- Name planning documents with the `*.plan.md` suffix so they are distinguishable from durable documentation.
- Keep each Markdown paragraph and list item on one source line.
- Comment only non-obvious code or configuration decisions, including a link to authoritative documentation or an issue.

## Environment

- Keep environment files at the repository root. Commit only reviewed non-secret templates and defaults (`.env`, `.env.example`, `.env.development`, and its `.env.test` symlink); never commit credentials or deployment-specific values.
- Reuse `@astralbeam/utils/environment` from application and standalone-tool configuration instead of adding package-local loaders or environment files. Shell, CI, and deployment variables must take precedence over file values.

## Shared UI

- `packages/ui` owns the monorepo's only `components.json` and all shadcn-generated components, hooks, and utilities; applications import them from `@astralbeam/ui`.
- Add components from the repository root with `vp run @astralbeam/ui#ui add <component>`.

## Database

- Keep PostgreSQL and Drizzle code in the server-only `packages/db` package and import it through `@astralbeam/db`.
- Run database commands from the repository root with `vp run @astralbeam/db#db <command>`.
- After schema changes, run `generate --name <description>`, inspect the SQL, run `check`, and commit schema and migration files together.
- Use `migrate` for checked-in migrations; reserve `push --explain` for local prototypes. Use the provided `DATABASE_URL` and never commit credentials or package-local environment files.

## Authentication

- Keep Better Auth server configuration and reusable TanStack Start auth utilities in `packages/auth`; applications consume its explicit `@astralbeam/auth/*` exports.
- Keep Google and GitHub OAuth as the only sign-in methods and Better Auth Organizations as the SaaS membership boundary; do not enable email/password, two-factor authentication, teams, or dynamic organization roles unless product scope explicitly changes.
- Regenerate the auth schema with `vp run auth:generate`, then follow the database migration workflow and commit the schema and migration together.
- Route guards are navigation UX, not authorization. Protect organization-owned server functions with `organizationMiddleware`, using `freshOrganizationMiddleware` for sensitive or destructive operations; use `authMiddleware` only for authenticated operations intentionally outside an organization.

## Cursor Cloud

- For UI changes, verify the affected flow through browser computer use and attach a screenshot or video artifact.
