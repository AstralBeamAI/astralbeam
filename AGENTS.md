# AstralBeam development

## Change discipline

- Before non-trivial work, inspect applicable instructions, the current Git base and diff, source, generated artifacts, and installed APIs. Research large changes first, then batch open design decisions with recommendations.
- Keep changes narrow and convention-aligned. Prefer supported defaults, existing infrastructure, top-level imports when initialization is safe, and fewer total lines without sacrificing readability or useful function boundaries. Keep named helpers that clarify intent, even with one caller. Keep dynamic imports for bootstrap availability and intentional lazy loading. A deduplication refactor should reduce repetition while preserving readable function boundaries.
- Implement and verify the smallest useful slice, normally one PR per area. Fix defects in the path being changed, but ask before unrelated changes or third-party issues and PRs. Research, plans and instruction updates do not authorize implementation or resuming paused work.
- Keep tests for security, persistence, concurrency, cancellation, recovery, and observed regressions. Remove redundant tests, fixtures, speculative handling, and one-use abstractions. Fix missing operator inputs through prompts, defaults, or flags instead of manual workarounds.
- Verify uncertain tooling behavior with a small experiment. Stop a third-party CLI blocked for more than two minutes and report how to test it. Link unavoidable upstream workarounds and their removal conditions.
- Before completion, review correctness, scope, complexity, and all still-applicable user requests. Finish authorized omissions, identify anything deferred or unverified, and disclose instruction edits that permit the change. Incorporate durable corrections into an existing instruction when possible, without accumulating incident narratives.

## Tooling and validation

- Use Bun through `bun run --cwd <project> <task>` or from the affected project directory. On macOS run application code natively, using a devcontainer only when requested. Do not install or invoke Node, npm, npx, or ESLint directly, or declare or configure ESLint. SDK consumers may use their host's package manager, and the Rails example follows its own instructions and `bin/ci`.
- Commit only reviewed non-secret environment defaults, never credentials, deployment values, or `*.local`. Preserve `env = false` in every Bun configuration, shell/CI/deployment precedence over files, and standalone environment loading local to its tool.
- Keep application-defined HTTP freshness windows for mutable public resources production-only. Development responses must revalidate so local edits are visible.
- Keep root `package.json` a launcher for six explicit workspaces. Preserve `check`, `test`, and `build` meanings, compose `ready` through `scripts/ready.ts`, and put reusable gates in `check` rather than CI-only steps.
- Root `tsconfig.base.json` holds shared compiler defaults, including `lib: ["ES2025"]`. Each project's `tsconfig.json` extends it, overrides `lib` when needed, and keeps its own `jsx`, `types`, `paths`, and file globs.
- Use project Oxlint and oxfmt tasks. Keep lint configurations structurally aligned, retain preset options, and assign each rule one owner. Fix findings in code without suppressions or overrides. Exclude only generated or registry-vendored sources, disable rules only for linked upstream defects, and re-audit presets, compatibility issues, and plugin loaders on upgrades.
- Before `bun run knip:fix`, commit or back up untracked work, then inspect the full diff before `check:fix`. Knip entries must be real execution roots. Keep application entry exports checked and SDK public exports exempt. Ignore registry export noise without excluding unreachable files from discovery.
- Run `scripts/setup.sh` once after pulling. Otherwise choose the smallest relevant validation. Do not automatically run `check`, `test`, or `ready`. Run `ready` once before creating a PR or when requested, without separate check/test runs except to diagnose failures. Version-only bumps may skip it. For documentation and instruction changes, pre-PR validation is source review and `git diff --check`.
- Run JS/TS tests with Vitest through project tasks, never `bun test` or `bun:test`. Keep Playwright `e2e` outside `check`, `test`, and `ready`. Use the [project browser skill](.agents/skills/test-platform-in-browser/SKILL.md) for UI verification and current screenshot or video evidence. Setup/workflow changes need proof of their advertised outcome. Distinguish local, hosted, and deployed evidence.
- For PR creation and subsequent pushes, follow the [PR skill](.agents/skills/create-github-pr/SKILL.md). Skip its browser suites for website-only changes.
- Before an authorized merge, refetch the head, required checks, and reviews. Merge only with passing required checks and no actionable feedback. For stacked PRs use `gh api -X PUT repos/AstralBeamAI/astralbeam/pulls/<n>/merge-async`. After a parent squash, resolve the child's add/add conflicts with `git merge -X ours origin/main`, reapply main's fixes, and verify its intended diff is unchanged.
- Use plain single shell commands with absolute paths or `bun run --cwd`, and scripts for multi-step logic. Keep scratch files and evidence outside the worktree in a task-unique directory, never shared paths such as `/tmp/pr-body.md`.
- Upgrade dependencies with `bun update <package>@latest --minimum-release-age=0`, aligning exact-pinned siblings. Bump versions only when asked, update pinned SDK URLs with `git grep '@astralbeam/sdk@'`, and below 1.0 use a minor bump for breaking changes and a patch otherwise.
- Use `bun run audit` for dependency advisories and honor [reviewed advisory assessments](SECURITY.md#dependency-advisory-assessments) only while their applicability conditions hold. Reassess changed dependency paths or trust boundaries before reporting or retaining an exception.

## Product conventions

- An Organization is an AstralBeam customer, organization users are its dashboard users, Tenants are its customers, and TenantUsers interact with the embedded sidebar. The dashboard assistant is Astro. Keep organization, tenant, and tenant-user authority distinct.
- Organization UUIDs are immutable and slugs are editable URL identifiers only. Never use slugs as credential, token, relationship, or seed identity.
- Entity IDs are opaque UUIDs. Public IDs are `agent_<organizationId>_<id>` and `key_<organizationId>_<id>`.
- Follow [Platform instructions](platform/AGENTS.md) for Platform, database, and theme work, including shared repository scripts, Compose, and local resources outside that directory.

## UI and documentation

- External HTTP(S) links, including Markdown, use `target="_blank"` and `rel="noopener noreferrer"`. Preserve internal navigation, downloads, and non-web protocols.
- Prefer icon-only routine actions with accessible names and hover/focus tooltips. Keep labels for choices, primary form actions, and destructive confirmations.
- Platform and SDK own independent registry components and styles. Add components with the owning project's `bun run ui add <component>`, use Phosphor rather than Lucide, and start each generated file's provenance header with `// Added from @<registry>/<item>`, recording every local change.
- Keep consumer docs about setup, usage, behavior, and troubleshooting. Use `SETUP.md` for contributor setup and existing architecture/module guides for rationale. Preserve useful references, safety guidance, and copy-pasteable commands when shortening docs, without duplicating command sections elsewhere.
- Keep shared rules here and project-specific constraints in the closest AGENTS file, linking them for callers outside that scope. Focus on non-obvious constraints and task-specific links. Delete duplicated or tooling-enforced instructions instead of relocating them, preserve enforcement gaps, and avoid speculative future designs. Do not remove unrelated instructions without authorization.
- Name plans `*.plan.md` and include motivation, authoritative references, affected files/API anchors, validation, and boundaries. Keep plans and PR descriptions concise and evidence-backed.
- Outside formatter coverage, keep Markdown paragraphs/list items on single source lines with blank lines before lists. Avoid semicolons and em dashes in prose. Preserve exact quotes, code, and licenses. Code comments explain only non-obvious decisions, link authoritative evidence, and stay within two lines.
