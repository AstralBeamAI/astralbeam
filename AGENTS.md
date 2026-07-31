<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite. From the repository root, run project commands through `vp run <script>`; package scripts invoke the underlying Vite+ commands. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp run check` and `vp run test` to format, lint, type check and test changes through the repository tasks.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Documentation convention

- Use a folder's `README.md` for consumers of its public API.
- Use a folder's `AGENTS.md` for authors editing its contents.
- Keep each Markdown prose paragraph and list item on one source line; rely on editor word wrap instead of inserting fixed-width line breaks.
- Whenever you create an `AGENTS.md`, create a sibling `CLAUDE.md` symlink to it with `ln -s AGENTS.md CLAUDE.md`; never duplicate the instructions.

## Shared UI workflow

- Keep `packages/ui/components.json` as the only shadcn configuration in the monorepo; do not create app-level `components.json` files.
- Keep every shadcn-generated component, hook, and utility in `packages/ui`; applications consume them through `@astralbeam/ui` exports.
- Add shadcn components from the repository root with `vp run @astralbeam/ui#ui add <component>`.

## Database workflow

- The shared PostgreSQL and Drizzle implementation lives in `packages/db`.
- Run database commands from the repository root through `vp run @astralbeam/db#db <command>`.
- After changing a schema, run `generate` with a descriptive `--name`, inspect the generated SQL, run `check`, and commit the schema and migration files together.
- Use `migrate` for checked-in migrations. Treat `push` as a local prototyping command, preview it with `push --explain`, and do not use it as the normal deployment workflow.
- Import `@astralbeam/db` only from server-only modules.
- Use the environment-provided `DATABASE_URL`; do not commit credentials or package-local environment files.
