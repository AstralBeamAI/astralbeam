# Contributing to AstralBeam

Thanks for your interest in AstralBeam. This page covers how to set up the repository, how to validate a change, and what a pull request should contain.

Questions and ideas are welcome on [Discord](https://discord.gg/suehFycUvW). Vulnerabilities go through [private reporting](SECURITY.md), never a public issue. All participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Get set up

Follow [SETUP.md](SETUP.md) for one-time prerequisites, then [Local development](#local-development) for starting the services, installing dependencies, seeding the database, and running the dev servers.

Deno is the only supported runtime and package manager for this repository. Vite and npm tooling run through Deno's compatibility layer.

## Codebase structure

The repository holds six independent Deno projects that do not form a package-manager workspace:

- `platform`, the TanStack Start product application, database, theme, and dashboard UI with app-local shadcn/ui components.
- `www`, the public website, a prerendered TanStack Start application.
- `sdk`, the frontend SDK published to npm as `@astralbeam/sdk`.
- `cli`, the organization admin CLI published to npm as `@astralbeam/cli` and as Deno binaries.
- `examples/linearity-react`, [Linearity](examples/linearity-react), a multi-workspace project tracker with an embedded Astro assistant that consumes the built SDK.
- `examples/todos`, a minimal standalone application that consumes the built SDK.

`examples/todos-rails` is a Ruby on Rails consumer of the published SDK outside the Deno toolchain. Validate it with `bin/ci` from its directory, which CI runs too.

Each owns its dependencies, lockfile, and tooling. [ARCHITECTURE.md](ARCHITECTURE.md) explains how they fit together, and [AGENTS.md](AGENTS.md) holds the implementation rules that reviews apply.

## Local development

Run the applications natively with Deno and the database services through Docker Compose or Podman Compose.

### Start PostgreSQL and Mailpit

Compose starts PostgreSQL, PgBouncer, Valkey, and Mailpit. The default `DATABASE_URL` in [`platform/.env.development`](platform/.env.development) points at PgBouncer, the only database endpoint published to the host. On macOS, run Deno natively and use Compose for these services.

From the repository root, start the services with Docker:

```sh
docker compose up --detach --wait
```

Or use Podman, then wait for the services to become healthy:

```sh
podman compose up --detach
podman compose ps
```

Mailpit captures outgoing email on SMTP port 1025. Read it in the [local inbox](http://localhost:8025) on port 8025.

### Set up the projects

Install dependencies, migrate, seed local data, and build the SDK:

```sh
./scripts/setup.sh
```

The [seed](platform/src/db/README.md#seed-sample-data) creates local accounts and credentials and writes `examples/todos/.env` and `examples/todos-rails/.env` only when absent. Bootstrap defaults are in [`platform/.env.development`](platform/.env.development). Manage runtime settings at `/configure` using the first `DATABASE_ENCRYPTION_KEY` value.

### Chat credentials

Chat runs on the organization's own OpenAI API key, which owners set in the dashboard under **Settings**. Put a key of your own in `platform/.env.local` and the seed gives it to every seeded organization:

```sh
OPENAI_API_KEY=sk-...
```

### Run everything

```sh
deno task dev
```

This starts the four dev servers and the SDK watcher together:

- <http://localhost:4500>, the product application and its `/api/v1/chat` agent endpoint
- <http://localhost:4600>, the public website
- <http://localhost:4900>, Linearity with projects, issues, cycles, and Astro. Set its Basic Auth credentials first using [the example setup](examples/linearity-react/README.md)
- <http://localhost:4700>, the todos example with the embedded widget. See [`examples/todos/README.md`](examples/todos/README.md) for what to try

The Ruby on Rails version of the example runs separately with `bin/setup` from `examples/todos-rails` and opens on <http://localhost:3000>. See [`examples/todos-rails/README.md`](examples/todos-rails/README.md).

Reload the page after changing SDK sources: the watcher rewrites the `sdk/dist` output the example imports.

### Project commands

Run from the repository root:

```sh
deno task install  # all project dependencies
deno task dev      # all apps and the SDK watcher
deno task build    # all projects, SDK first
```

Per-project aliases include `deno task dev:platform`, `deno task build:sdk`, and `deno task install:todos`. Other tasks use `deno task --cwd <project> <task>`. Run `deno task` to list root commands.

For account creation and email delivery, follow [Authentication setup](SETUP.md#authentication-and-transactional-email).

## Validate your change

Every project defines the same tasks, where `check` covers formatting, linting, and typechecking, and `ready` means `check`, `test`, and `build` together. Run `ready` once for each project you touched before opening a pull request, rather than running `check` and `test` separately:

```sh
deno task --cwd platform ready
deno task --cwd www ready
deno task --cwd sdk ready
deno task --cwd cli ready
deno task --cwd examples/todos ready
deno task --cwd examples/linearity-react ready
```

Documentation-only changes need source review and `git diff --check`, not a full `ready`.

The browser suites run through their own `e2e` tasks, for example `deno task --cwd examples/todos e2e`. They need Playwright browsers and running services, so they stay out of `check`, `test`, `ready`, and CI. Run them locally when you change a flow they cover.

CI runs `ready` for all six projects, compiles and smoke-tests the platform and CLI binaries, and runs the deterministic browser specs.

## Pull requests

- Keep diffs small and focused on one change. Split unrelated work into separate pull requests.
- Include a Validation note saying which tasks you ran and what you could not verify.
- Update the affected documentation in the same pull request.
- Do not bump versions or add release tags. Releases are cut by the maintainers.

## Licensing of contributions

Different parts of this repository carry different licenses. Files under [`www`](www), [`sdk`](sdk), [`cli`](cli), and [`examples`](examples) are under the [MIT License](LICENSE-MIT), and all other files are under the [GNU Affero General Public License v3.0 only](LICENSE-AGPL). Your contribution lands under the license that applies to the files you touch.

AstralBeam also asks contributors to agree to the [Contributor License Agreement](docs/legal/CLA.md). It grants AstralBeam Inc. a copyright and patent license to your contribution and lets AstralBeam license that contribution onward under any terms, expressly including AGPL-3.0-only, the MIT License, and proprietary or commercial terms. That is what makes separate proprietary licensing and closed distributions possible alongside the open source releases. You keep ownership of your contribution and every right to use it yourself.

One document covers both individuals and entities. If you contribute as an employee and your employer holds rights in the work, the agreement asks you to confirm either that you are authorized to bind your employer or that your employer has assigned or waived those rights, and to identify the entity you are binding.

Agreement is collected when a contribution is proposed, by ticking the CLA acknowledgement in the pull request template, which records the CLA version you agreed to. There is no automation for this in the repository today. [CLA Assistant](https://cla-assistant.io) is the usual GitHub App for collecting agreements automatically, and installing it is a decision for the repository owner.

## Releasing

Releases are maintainer-only. One tag `vX.Y.Z` releases the platform, the SDK, and the CLI together, and [`.github/workflows/release.yml`](.github/workflows/release.yml) does the work. A tag alone does not put either package on npm.

1. Make sure `sdk/package.json` and `cli/package.json` are both already at the version you are about to tag. They are the only versioned projects and move in lockstep, so the workflow fails immediately if the tag and either version disagree.
2. Push the tag by running `deno task release` from the repository root on an up-to-date `main`. It checks that the three versions match and the tag is new, lists the commits since the previous tag, tags and pushes `HEAD` after you confirm, and links the Actions page and npm Staged Packages page for the next steps.
3. The workflow builds the SDK and CLI, compiles and smoke-tests the platform binary and the five CLI binaries, stages both packages on npm with `npm stage publish`, and creates the GitHub release marked as latest, with auto-generated notes and every binary attached under a version-free name, so `releases/latest/download/<asset>` URLs always serve the newest build.
4. A maintainer approves each staged package with `npm stage approve <stage-id>`, or from the Staged Packages tab on npmjs.com. Approval prompts for 2FA, and only then is a package public. The run's job summary prints the stage ids.

Before approving, inspect the staged package with `npm stage list`, `npm stage view <stage-id>`, and `npm stage download <stage-id>`.

Run the workflow manually from the Actions tab with the `dry-run` input to exercise the builds without creating a release or staging anything.

Both packages publish through [npm trusted publishing](https://docs.npmjs.com/trusted-publishers), so there is no npm token in the repository. Each package's trusted publisher on npmjs.com names this repository and the workflow filename `release.yml` exactly, both case-sensitive. It leaves the "Allowed actions" setting unchecked, which is the stage-only default and keeps the 2FA approval gate in place.
