# AstralBeam development

## Change discipline

- Before non-trivial work, inspect applicable instructions, the current Git base and diff, source, generated artifacts, and installed APIs. Research large changes first, then batch open design decisions with recommendations.
- Keep changes narrow and convention-aligned. Prefer supported defaults, existing infrastructure, top-level imports when initialization is safe, and fewer total lines. Keep dynamic imports for bootstrap availability and intentional lazy loading. A deduplication refactor must not increase total lines.
- Implement and verify the smallest useful slice, normally one PR per area. Fix defects in the path being changed, but ask before unrelated changes or third-party issues and PRs. Research and plans do not authorize implementation or resuming paused work.
- Keep tests for security, persistence, concurrency, cancellation, recovery, and observed regressions. Remove redundant tests, fixtures, speculative handling, and one-use abstractions. Fix missing operator inputs through prompts, defaults, or flags instead of manual workarounds.
- Verify uncertain tooling behavior with a small experiment. Stop a third-party CLI blocked for more than two minutes and report how to test it. Link unavoidable upstream workarounds and their removal conditions.
- Before completion, review correctness, scope, complexity, and all still-applicable user requests. Finish authorized omissions, identify anything deferred or unverified, and disclose instruction edits that permit the change. Incorporate durable corrections into an existing instruction when possible, without accumulating incident narratives.

## Tooling and validation

- Use Bun through `bun run --cwd <project> <task>` or from the affected project directory. Do not install or invoke Node, npm, npx, or ESLint directly. SDK consumers may use their host's package manager, and the Rails example follows its own instructions and `bin/ci`.
- Keep root `package.json` a launcher for six explicit workspaces, shared compiler options in `tsconfig.base.json`, and project-specific configuration in each project. Preserve `check`, `test`, and `build` meanings, compose `ready` through `scripts/ready.ts`, and put reusable gates in `check` rather than CI-only steps.
- Use project Oxlint and oxfmt tasks. Keep lint configurations structurally aligned, retain preset options, and assign each rule one owner. Fix findings in code without suppressions or overrides. Exclude only generated or registry-vendored sources, disable rules only for linked upstream defects, and re-audit presets, compatibility issues, and plugin loaders on upgrades.
- Before `bun run knip:fix`, commit or back up untracked work, then inspect the full diff before `check:fix`. Knip entries must be real execution roots. Keep application entry exports checked and SDK public exports exempt. Ignore registry export noise without excluding unreachable files from discovery.
- Run `scripts/setup.sh` once after pulling. Otherwise choose the smallest relevant validation. Do not automatically run `check`, `test`, or `ready`. Run `ready` once before creating a PR or when requested, without separate check/test runs except to diagnose failures. Version-only bumps may skip it. Documentation and instruction changes need only source review and `git diff --check`.
- Run JS/TS tests with Vitest through project tasks, never `bun test` or `bun:test`. Keep Playwright `e2e` outside `check`, `test`, and `ready`. Use the [project browser skill](.agents/skills/test-platform-in-browser/SKILL.md) for UI verification and current screenshot or video evidence. Setup/workflow changes need proof of their advertised outcome. Distinguish local, hosted, and deployed evidence.
- After creating or pushing a PR, follow the [post-PR checks](.agents/skills/create-github-pr/SKILL.md#post-pr-checks), including both parallel browser suites and the existing validation-results comment. Skip those suites for website-only changes. Follow the PR skill for publication.
- Before an authorized merge, refetch the head, required checks, and reviews. Merge only with passing required checks and no actionable feedback. For stacked PRs use `gh api -X PUT repos/AstralBeamAI/astralbeam/pulls/<n>/merge-async`. After a parent squash, resolve the child's add/add conflicts with `git merge -X ours origin/main`, reapply main's fixes, and verify its intended diff is unchanged.
- Use plain single shell commands with absolute paths or `bun run --cwd`, and scripts for multi-step logic. Keep scratch files and evidence outside the worktree in a task-unique directory, never shared paths such as `/tmp/pr-body.md`.
- Upgrade dependencies with `bun update <package>@latest --minimum-release-age=0`, aligning exact-pinned siblings. Bump versions only when asked, update pinned SDK URLs with `git grep '@astralbeam/sdk@'`, and below 1.0 use a minor bump for breaking changes and a patch otherwise.

## Identity and environment

- An Organization is an AstralBeam customer, organization users are its dashboard users, Tenants are its customers, and TenantUsers interact with the embedded sidebar. The dashboard assistant is Astro. Keep organization, tenant, and tenant-user authority distinct.
- Organization UUIDs are immutable, slugs are editable URL identifiers only, and only the organization table may have a `slug` column. Never use slugs as credential, token, relationship, or seed identity. Changing a slug breaks old URLs.
- Give every entity its own opaque UUID and separate foreign-key columns. First-party organization-owned keys include `(organization_id, id)`, with further Tenant/thread scope where applicable. Better Auth retains adapter-compatible keys. Public IDs are `agent_<organizationId>_<id>` and `key_<organizationId>_<id>`.
- On macOS run applications natively with Bun, Compose PostgreSQL/PgBouncer/Valkey/Mailpit, and native RustFS. Use a devcontainer only when requested. Never install host PostgreSQL or Valkey through setup. When an existing local PostgreSQL service is explicitly requested, use it directly without starting containers and preserve database isolation.
- Provision through existing setup tasks and installed tools, without initializer containers, following [SETUP.md](SETUP.md). Preserve PgBouncer as the only loopback-published database endpoint and existing backend/host-port overrides. Direct `docker compose exec postgres` is for explicit administration. Only Codex Cloud Ubuntu uses `INSTALL_EXTRA=codex-db` with `SKIP_DOCKER_COMPOSE=true`.
- Each worktree owns a database named for its unique folder, such as `a3f4` in `.../a3f4/astralbeam`, and a bucket derived from that database. `copy-worktree-env.sh` resets only that database before setup. Keep `db-reset` free of migrations, never recreate shared volumes, and preserve configured storage on setup reruns.
- Keep Platform environment files under `platform`, commit only reviewed non-secret defaults, and never commit credentials, deployment values, or `*.local`. Preserve `env = false` in Bun configuration and shell/CI/deployment precedence over files. Keep runtime settings in database config at `/configure` and standalone environment loading local to its tool.

## UI and documentation

- External HTTP(S) links, including Markdown, use `target="_blank"` and `rel="noopener noreferrer"`. Preserve internal navigation, downloads, and non-web protocols. Numbered citation badges have no arrows. Consulted-source titles get smaller arrows through CSS.
- Prefer icon-only routine actions with accessible names and hover/focus tooltips. Keep labels for choices, primary form actions, and destructive confirmations.
- Platform and SDK own independent registry components and styles. Add components with the owning project's `bun run ui add <component>`, use Phosphor rather than Lucide, and record the registry item and every local change in each generated file's provenance header.
- Keep consumer docs about setup, usage, behavior, and troubleshooting. Use `SETUP.md` for contributor setup and existing architecture/module guides for rationale. Preserve useful references, safety guidance, and copy-pasteable commands when shortening docs, without duplicating command sections elsewhere.
- Keep AGENTS files focused on non-obvious constraints and task-specific links. Delete duplicated or tooling-enforced instructions instead of relocating them, preserve enforcement gaps, and avoid speculative future designs. Do not remove unrelated instructions without authorization.
- Name plans `*.plan.md` and include motivation, authoritative references, affected files/API anchors, validation, and boundaries. Keep plans and PR descriptions concise and evidence-backed.
- Outside formatter coverage, keep Markdown paragraphs/list items on single source lines with blank lines before lists. Avoid semicolons and em dashes in prose. Preserve exact quotes, code, and licenses. Code comments explain only non-obvious decisions, link authoritative evidence, and stay within two lines.
- For `/docs`, follow the [house voice](https://swiftace.org): open with the subject and action, use "let's" and "we" for procedures and "you" for reader state, explain a command's purpose and reason before it, number steps, label asides `**NOTE**:` or `**TIP**:`, and reserve tables for reference data.

## Theme and brand

- Keep the theme compiler under `platform/scripts/theme` pure and outside runtime imports. `brand.json` owns Platform colors, while SDK colors remain independent. Keep hand-authored Platform CSS theme-agnostic and synchronize compiler schemas with `theme.schema.json`.
- After theme changes run `bun run --cwd platform generate:theme` and refresh email sRGB values from its output. After SVG master changes run `bun run --cwd platform generate:png`. Keep logo masters and variants under `platform/public`.

## Database

- Use PostgreSQL 18+ and database commands through `bun run --cwd platform db <command>`. After schema changes run `generate --name <description>`, review SQL, run `check`, and commit schema with migrations. Apply only checked-in migrations with `migrate`, never Drizzle `push`, including `--explain`. Effect owns its `effect_cluster_*` migrations separately.
- Use PostgreSQL `uuid` keys with database-generated `uuidv7()`, `citext` email identity, and `timestamp with time zone` without forced precision. Keep SQL identifiers lower snake case, text unconstrained, and timestamp ranges half-open. Follow PostgreSQL's [Don't Do This](https://wiki.postgresql.org/wiki/Don't_Do_This) guidance.
- Never rewrite migrations others may have applied. Include required extension DDL, and regenerate only unmerged, unapplied iterations unused by shared deployments. Preserve full immutable identity as colon-joined cache-key prefixes and scope cleanup to the same namespace. Read [Platform database constraints](platform/AGENTS.md#database) before schema, migration, or transaction changes.
