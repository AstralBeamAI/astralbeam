# AstralBeam development

- Use the product glossary consistently: an Organization is an AstralBeam customer (typically a SaaS app), organization users are that customer's employees who use the AstralBeam dashboard, Tenants are the Organization's customers, and tenant users (`TenantUser`) are the Tenants' users who interact with the embedded agent sidebar.
- Organizations have immutable UUIDs and editable slugs. Only the organization table may have a `slug` column. Use organization slugs only for URLs and their validation, never as identity in credentials, tokens, relationships, or seed lookups. Changing the slug breaks old URLs.
- Other entities use opaque UUIDs. First-party organization-owned tables use `(organization_id, id)` primary keys. Better Auth tables retain their adapter-compatible keys. Compose public agent IDs as `agent_<organizationId>_<id>` and API-key IDs as `key_<organizationId>_<id>`.

## Tooling and validation

- Use Deno from the affected project directory (`platform`, `www`, `sdk`, `cli`, or `examples/todos`) with `deno task <script>`, or from the repository root with `deno task --cwd <project> <script>`. The projects do not form a package-manager workspace. Deno is the only supported repository JavaScript runtime and package manager. Vite and npm tooling run through its compatibility layer. SDK consumer examples may use the host application's package manager.
- `examples/todos-rails` is a Ruby on Rails consumer outside the five Deno projects and their Oxlint, oxfmt, and Knip rules. Follow its `AGENTS.md` and validate it with its own `bin/ci`.
- Keep every project's `check`, `test`, and `build` tasks meaning the same thing, and `ready` meaning `check`, `test`, and `build`. `www` alone runs `build` before `test`, because its test reads the build output.
- Compose reusable validation gates in the affected project's `check` task so local and CI checks stay aligned. Keep workflow additions limited to environment provisioning and checks that require a distinct execution environment.
- Root `tsconfig.base.json` holds only the compiler options all five projects share. Each `tsconfig.json` `extends` it and keeps its own `jsx`, `lib`, `types`, `paths`, and file globs.
- Lint with Oxlint and format with oxfmt through each project's `lint` and `format` tasks and its own `oxlint.config.ts` and `.oxfmtrc.json`. Do not use `deno lint`, `deno fmt`, or Deno `lint`/`fmt` configuration. Do not install or invoke Node, npm, or npx, or directly declare, configure, or invoke ESLint. Transitive ESLint peer lock entries are acceptable.
- Keep the five `oxlint.config.ts` files structurally identical, differing only in the presets for libraries the project uses and its generated-path ignores. Import presets with their rules and options, raise every severity to `error`, and give overlapping rules one owner.
- Fix lint findings in code. Do not add disable comments, file-scoped overrides, or rules turned off to hide findings. Exclude only generated or registry-vendored paths, and turn a rule off only for a linked upstream defect.
- When updating Oxlint or plugin lock entries, re-audit imported presets, recheck every linked compatibility issue, and smoke-test all plugin loaders.
- Keep the root `deno.jsonc` a launcher for the five projects, with `format` and `format:check` tasks and a root `.oxfmtrc.json` limited to files directly in the root. CI must run the root `format:check` task. Do not add a `workspace` field, project-specific lint configuration, or root copies of per-project tasks such as `check`, `test`, and `ready`.
- Prefer top-level imports when module initialization is safe. Keep dynamic imports where they preserve bootstrap availability, database-independent tooling, development-only code, or intentional lazy loading.
- Before non-trivial changes, inspect the current code, instructions, Git base and diff, generated artifacts, and installed APIs. Prefer supported upstream contracts, narrow diffs that preserve original names and code structure where semantics allow, and removing one-use helpers over custom plumbing or speculative abstraction.
- Ask before writing or changing code outside the user's explicitly requested scope. Research, planning, and instruction updates do not authorize implementation or resuming previously paused implementation.
- Before running `deno task knip:fix`, commit or back up untracked work because it can delete unused files that Git cannot restore. Then inspect the complete project diff before running `deno task check:fix`.
- Reserve Knip entries for actual execution or externally discovered roots, and add reusable modules only when code uses them. Do not hide speculative modules or accidental exports with entries. Keep `includeEntryExports` enabled in the four applications, including `cli`, whose entry exports must also be used in-project, and off in `sdk`, whose entry-point exports are the published npm surface.
- Run `scripts/setup.sh` once after pulling to install the OS-level tooling and the projects' frozen dependencies. Otherwise, use the smallest relevant project task or syntax/configuration check. Documentation and instruction changes need only source review and `git diff --check`.
- Do not automatically run `deno task check`, `deno task test`, or `deno task ready`. `ready` already runs checks, tests, and builds. Run it once before creating a PR or when explicitly requested, without separate `check` or `test` runs unless diagnosing a failure.
- Run JavaScript and TypeScript tests with Vitest through the project's Deno task, never `Deno.test` or `deno test`. The `platform` and todos browser suites use Playwright through their own `e2e` tasks, which stay out of `check`, `test`, `ready`, and CI.
- When coding or reviewing, remove low-value or redundant tests and unnecessary fixtures/mocks. Keep tests that protect durable behavior, security boundaries, or observed regressions. Prefer short, direct tests and code over verbose setup or abstractions unless the extra complexity catches a distinct, worthwhile failure. Do not retain tests merely to restate implementation details, trivial constants, or generated structure.
- Bump the version only when the user asks. Keep `sdk/package.json`, `cli/package.json`, and `platform/package.json` at one version, and update every pinned `@astralbeam/sdk@<version>` URL (`git grep '@astralbeam/sdk@'`) to match. Below 1.0, bump the minor version for breaking changes and the patch version otherwise. [`CONTRIBUTING.md`](CONTRIBUTING.md) still tells outside contributors to leave versions to the maintainers.
- Before final validation, turn durable, non-obvious user corrections into one concise, nonduplicative instruction in the closest `AGENTS.md` or skill. Skip one-off decisions and preferences.

## Documentation

- Keep SDK/API consumer docs focused on setup, usage, behavior, and troubleshooting. Keep implementation policy in `AGENTS.md`, contributor setup in `SETUP.md`, and system rationale in `ARCHITECTURE.md`. When shortening a README, preserve useful reference sections, options tables, examples, and workflows. Prune details already covered by a linked reference when they are not critical to everyday development. Keep essential setup, safety guidance, and useful quick references in the README, and retain important content absent from linked docs. Link to the owning explanation, but preserve copy-pasteable common commands in files that already listed them. Do not add new command sections elsewhere. Include the working directory or use `deno task --cwd <project> <task>`.
- Preserve existing `AGENTS.md` and skill instructions unless removal is explicit or resolves a documented conflict.
- Name planning documents with the `*.plan.md` suffix so they are distinguishable from durable documentation.
- Keep plans and PR descriptions concise and evidence-backed. Plans must still include motivation, authoritative references, affected files and API anchors, validation, and boundaries.
- Keep each Markdown paragraph and list item on one source line, with blank lines before lists. Apply these rules to instruction files too. Preserve code syntax, exact quoted output, and third-party license text.
- Avoid semicolons and em dashes in documentation and Markdown prose. Use periods or commas instead.
- Write `/docs` consumer prose in the house voice, which the posts at [swiftace.org](https://swiftace.org) model. Open by naming the subject and what we are about to do, never by describing the page. Use "let's" and "we" through a procedure and "you" for the reader's own state and consequences. Give every command a lead-in that names its purpose, state a reason cause first in the same sentence, number sequential steps, label asides `**NOTE**:` or `**TIP**:`, and keep tables for enumerable reference data rather than explanation.
- Comment only non-obvious code or configuration decisions, including a link to authoritative documentation or an issue.
- Keep code comments to at most two lines. Longer reasoning belongs in the nearest `AGENTS.md` or a linked issue.

## Environment

- Keep Platform environment files under `platform`. Commit reviewed non-secret environment files such as `.env`, `.env.development`, `.env.test`, and `.env.example`. Ignore `*.local` files and never commit credentials or deployment-specific values.
- Keep the platform's bootstrap environment variables and optional deployment overrides documented in `platform/AGENTS.md`. Other runtime settings live in its database `config` table and are managed at `/configure`. Keep standalone tool loading local to the tool configuration, with shell, CI, and deployment variables taking precedence over file values.
- Give every local worktree its own PostgreSQL database named exactly after its unique worktree folder. In Codex's nested layout, use the directory immediately above the repository checkout (`a3f4` for `.../worktrees/a3f4/astralbeam`), not the shared checkout basename. `copy-worktree-env.sh` must select, drop, and recreate that database with the `db-reset` task before `setup.sh` runs so every worktree starts fresh. Keep `db-reset` limited to recreating that database without migrations, and never recreate shared Compose volumes.
- On macOS, run application code natively with Deno and use Docker Compose or Podman Compose for PostgreSQL, PgBouncer, Valkey, and Mailpit. Use a devcontainer only when explicitly requested. Never install host PostgreSQL or Valkey from `scripts/setup.sh`. Keep PgBouncer as the only loopback-published PostgreSQL endpoint so local application and CLI traffic exercise transaction pooling. Preserve `POSTGRES_HOST` and `POSTGRES_PORT` as its backend overrides and `PGBOUNCER_HOST_PORT` as its host-published port override. Use `docker compose exec postgres` only for explicit direct database administration. Invoke `scripts/codex-db.sh` only through `INSTALL_EXTRA=codex-db` in Codex Cloud's Ubuntu environment, paired with `SKIP_DOCKER_COMPOSE=true` to prevent a Compose start.

## Platform and SDK UI

- `platform` and `sdk` each own a `components.json` and their own shadcn-generated components, hooks, and utilities under `platform/src/components/ui`, `platform/src/hooks`, and `platform/src/lib`, or the corresponding SDK paths under `sdk/src/widget`. Neither imports the other's.
- Add components from the owning project with `deno task ui add <component>`. Both `components.json` files use the phosphor icon library, but their styles diverge on purpose: the platform uses `base-lyra`/`mist`, while the SDK stays on the plain `b0` preset baseline (`base-nova`/`neutral`).
- At the top of each registry-added UI file, record the repeatable command as `// Added with: deno task ui add <component>` and every intentional local change. Omit nonessential automation flags such as `--overwrite` and `-y` from the recorded command.
- Let Knip remove unreachable registry UI files in both projects. Ignore generated export-level noise rather than excluding the directory from unused-file discovery.
- Use `@phosphor-icons/react` throughout Platform and SDK UI. Replace other icon-library imports in registry source during integration and do not add `lucide-react` as a dependency.
- Keep the hand-authored portions of `platform/src/styles.css` theme-agnostic. Concrete palette values belong only in its marked generated section. The theme blocks in `sdk/src/styles.css` are the chat widget's own palette, deliberately independent of the platform's. Edit them directly and do not resynchronize them with `brand.json`.

## Theme and brand

- Keep the semantic theme compiler design-time under `platform/scripts/theme`. It must stay a pure function of its input, without filesystem, HTTP, DOM, environment, or mutable global-state work, and nothing under `platform/src` may import it.
- Treat `platform/src/theme/brand.json` as the concrete theme source of truth and regenerate the marked theme section of `platform/src/styles.css` from `platform` with `deno task generate:theme` after changing it.
- Email clients cannot read the stylesheet's OKLCH tokens, so `platform/src/emails/email-theme.ts` inlines static sRGB values. Refresh them from the palette `deno task generate:theme` prints.
- Keep `platform/src/theme/theme.schema.json`, the compiler's schemas, and the independently published `www/src/brand/theme.schema.json` snapshot synchronized through explicit edits. Neither project may import the other.
- Keep SVG logo masters and their generated PNG variants under `platform/public` and regenerate the PNGs from `platform` with `deno task generate:png` after SVG changes.

## Database

- Keep PostgreSQL and Drizzle code under `platform/src/db`. Use the `.server.ts` suffix for server-only modules and never import the runtime client into browser code.
- Keep domain table and relation modules under `platform/src/db/schema`, re-export every module Drizzle Kit must discover from `platform/src/db/schema.server.ts`, and keep generated migrations under `platform/src/db/migrations`.
- Run database commands from `platform` with `deno task db <command>`.
- After schema changes, run `generate --name <description>`, inspect the SQL, run `check`, and commit schema and migration files together.
- Use PostgreSQL `uuid` primary and foreign keys with database-generated `uuidv7()` defaults, `citext` for email identity, and `timestamp with time zone` without forced precision for application instants. PostgreSQL 18 is the minimum supported server version.
- Define tables with `snakeCase.table`, keep TypeScript property names camel case, and omit redundant column-name arguments when Drizzle can derive the lower snake-case SQL name.
- Keep required extension DDL such as `CREATE EXTENSION IF NOT EXISTS citext` in the generated migration because a Drizzle `customType` does not install its PostgreSQL extension. Regenerate an unmerged, unapplied migration when refining the same schema change, but never rewrite migration history that may have been applied by others.
- Follow the applicable PostgreSQL [Don't Do This](https://wiki.postgresql.org/wiki/Don't_Do_This) guidance: keep identifiers lower snake case, use half-open timestamp ranges and `NOT EXISTS` where null-aware exclusion is needed, retain unconstrained `text`/`citext`, and avoid `timetz`, `CURRENT_TIME`, `char(n)`, default `varchar(n)`, `money`, `serial`, rules, table inheritance, and trust authentication over TCP/IP.
- Apply application database schema changes only through reviewed, checked-in migrations with `migrate`. Effect owns initialization and migrations for its `effect_cluster_*` tables, an explicit exception kept outside Drizzle schema management. Never use Drizzle `push`, including `push --explain`, in any environment or for local prototypes. Use the provided `DATABASE_URL` and never commit credentials or `*.local` environment files.

## Cursor Cloud

- For UI changes, verify the affected flow through browser computer use and attach current screenshot or video evidence. Distinguish local checks from hosted or deployed proof.
