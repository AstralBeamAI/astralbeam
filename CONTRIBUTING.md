# Contributing to AstralBeam

Thanks for your interest in AstralBeam. This page covers how to set up the repository, how to validate a change, and what a pull request should contain.

Questions and ideas are welcome on [Discord](https://discord.gg/suehFycUvW). Vulnerabilities go through [private reporting](SECURITY.md), never a public issue. All participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Get set up

Follow [SETUP.md](SETUP.md) to install prerequisites, start local services, seed the database, and run the applications.

Bun is the runtime and package manager for the six JavaScript/TypeScript projects. The Rails example uses Ruby and its own tooling.

## Codebase structure

The repository holds six Bun projects in one workspace:

- `platform`, the TanStack Start product application, database, theme, and dashboard UI with app-local shadcn/ui components.
- `website`, the public website, a prerendered TanStack Start application.
- `sdk`, the frontend SDK published to npm as `@astralbeam/sdk`.
- `cli`, the organization admin CLI published to npm as `@astralbeam/cli` and as Bun binaries.
- `examples/linearity-react`, [Linearity](examples/linearity-react), a multi-workspace project tracker with an embedded Astro assistant that consumes the built SDK.
- `examples/todos`, a minimal standalone application that consumes the built SDK.

`examples/todos-rails` is a Ruby on Rails consumer of the published SDK outside the Bun toolchain. Validate it with `bin/ci` from its directory, which CI runs too.

Each owns its dependencies and tooling, with one shared Bun lockfile. [ARCHITECTURE.md](ARCHITECTURE.md) explains how they fit together, and [AGENTS.md](AGENTS.md) holds the implementation rules that reviews apply.

The root security overrides advance TanStack's Daytona and Docker adapters to patched vendor dependencies, and Glob 13 and Minimatch 10 consumers to the fixed major versions. Remove each override when the parent packages accept the fixed versions from the <a href="https://github.com/advisories/GHSA-8988-4f7v-96qf" target="_blank" rel="noopener noreferrer">OpenTelemetry Core</a>, <a href="https://github.com/advisories/GHSA-45rx-2jwx-cxfr" target="_blank" rel="noopener noreferrer">Jaeger</a>, <a href="https://github.com/advisories/GHSA-j3f2-48v5-ccww" target="_blank" rel="noopener noreferrer">Protobuf.js</a>, <a href="https://github.com/advisories/GHSA-w5hq-g745-h8pq" target="_blank" rel="noopener noreferrer">UUID</a>, <a href="https://github.com/advisories/GHSA-3g3m-2fjr-6pw4" target="_blank" rel="noopener noreferrer">Glob</a>, and <a href="https://github.com/advisories/GHSA-g3hv-75wg-m249" target="_blank" rel="noopener noreferrer">Minimatch</a> advisories. OpenTelemetry API stays below 1.10 until the Effect-compatible telemetry packages accept it in their peer ranges.

The Deepmerge patch rejects `__proto__` keys in both merge inputs, including its distributed bundles. Remove it when an upstream release includes <a href="https://github.com/TehShrike/deepmerge/pull/274" target="_blank" rel="noopener noreferrer">the fix</a>. Bun's version-based audit still reports <a href="https://github.com/advisories/GHSA-gcqx-w48m-w2h4" target="_blank" rel="noopener noreferrer">the advisory</a> for patched 4.3.1.

## Validate your change

Each Bun project defines `check` for static validation, `test` for Vitest, and `build` for its distributable. `ready` runs all three and formats first outside CI. Run it once for each project you touched before opening a pull request:

```sh
bun run --cwd platform ready
bun run --cwd website ready
bun run --cwd sdk ready
bun run --cwd cli ready
bun run --cwd examples/todos ready
bun run --cwd examples/linearity-react ready
```

Documentation-only changes need source review and `git diff --check`, not a full `ready`.

Browser suites have separate `e2e` tasks and stay out of `check`, `test`, `ready`, and CI. Follow the [PR validation workflow](.agents/skills/create-github-pr/SKILL.md#post-pr-checks) after creating or pushing a PR. Website-only changes skip these suites.

CI runs checks, tests, and builds for all six projects and compiles and smoke-tests the platform and CLI binaries.

## Pull requests

- Keep diffs small and focused on one change. Split unrelated work into separate pull requests.
- Keep validation results in one PR comment, including the tasks run and anything unverified. Update that comment after later pushes.
- Update the affected documentation in the same pull request.
- Do not bump versions or add release tags. Releases are cut by the maintainers.

## Licensing of contributions

Different parts of this repository carry different licenses. Files under [`website`](website), [`sdk`](sdk), [`cli`](cli), and [`examples`](examples) are under the [MIT License](LICENSE-MIT), and all other files are under the [GNU Affero General Public License v3.0 only](LICENSE-AGPL). Your contribution lands under the license that applies to the files you touch.

AstralBeam also asks contributors to agree to the [Contributor License Agreement](docs/legal/CLA.md). It grants AstralBeam Inc. a copyright and patent license to your contribution and lets AstralBeam license that contribution onward under any terms, expressly including AGPL-3.0-only, the MIT License, and proprietary or commercial terms. That is what makes separate proprietary licensing and closed distributions possible alongside the open source releases. You keep ownership of your contribution and every right to use it yourself.

One document covers both individuals and entities. If you contribute as an employee and your employer holds rights in the work, the agreement asks you to confirm either that you are authorized to bind your employer or that your employer has assigned or waived those rights, and to identify the entity you are binding.

Agreement is collected through the versioned CLA acknowledgement in the pull request template. There is no CLA automation in this repository.

## Releasing

Releases are maintainer-only. One tag `vX.Y.Z` releases the platform, the SDK, and the CLI together, and [`.github/workflows/release.yml`](.github/workflows/release.yml) does the work. A tag alone does not put either package on npm.

1. Make sure `sdk/package.json`, `cli/package.json`, and `platform/package.json` already match the version you are about to tag. These projects move in lockstep, and the workflow fails if any version disagrees.
2. Push the tag by running `bun run release` from the repository root on an up-to-date `main`. It checks that the three versions match and the tag is new, lists the commits since the previous tag, tags and pushes `HEAD` after you confirm, or without asking when you pass `-y`, and links the Actions page and npm Staged Packages page for the next steps.
3. The workflow builds the SDK and CLI, cross-compiles platform and CLI binaries for five targets, smoke-tests their Linux x86_64 builds, and stages both npm packages. It then publishes the AMD64/ARM64 image to GHCR, verifies signatures and cleanup, and creates the GitHub release with generated notes, binaries, and `SHA256SUMS`. Version-free asset names keep `releases/latest/download/<asset>` URLs stable.
4. A maintainer approves each staged package with `npm stage approve <stage-id>` or from npmjs.com's **Staged Packages** tab. Approval requires 2FA, and only then are the packages public. The run summary identifies both stages.

Before approving, inspect the staged package with `npm stage list`, `npm stage view <stage-id>`, and `npm stage download <stage-id>`.

Run the workflow manually from the Actions tab with the `dry-run` input to exercise the builds without publishing images, creating a release, or staging anything.

Both packages publish through [npm trusted publishing](https://docs.npmjs.com/trusted-publishers), so there is no npm token in the repository. Each package's trusted publisher on npmjs.com names this repository and the workflow filename `release.yml` exactly, both case-sensitive. It leaves the "Allowed actions" setting unchecked, which is the stage-only default and keeps the 2FA approval gate in place.
