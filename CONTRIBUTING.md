# Contributing to AstralBeam

Thanks for your interest in AstralBeam. This page covers how to set up the repository, how to validate a change, and what a pull request should contain.

Questions and ideas are welcome on [Discord](https://discord.gg/suehFycUvW). Vulnerabilities go through [private reporting](SECURITY.md), never a public issue. All participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Get set up

Follow [SETUP.md](SETUP.md) for prerequisites, then [README.md](README.md#local-development) for starting the services, installing dependencies, seeding the database, and running the dev servers.

Deno is the only supported runtime and package manager for this repository. Vite and npm tooling run through Deno's compatibility layer.

## The four projects

The repository holds four independent Deno projects that do not form a package-manager workspace:

- `webapp`, the TanStack Start product application, database, theme, and dashboard UI.
- `www`, the public Astro website.
- `sdk`, the frontend SDK published to npm as `@astralbeam/sdk`.
- `examples/todos`, a standalone application that consumes the built SDK.

Each owns its dependencies, lockfile, and tooling. [ARCHITECTURE.md](ARCHITECTURE.md) explains how they fit together, and [AGENTS.md](AGENTS.md) holds the implementation rules that reviews apply.

## Validate your change

Every project defines the same tasks, where `check` covers formatting, linting, and typechecking, and `ready` means `check`, `test`, and `build` together. Run `ready` once for each project you touched before opening a pull request, rather than running `check` and `test` separately:

```sh
deno task --cwd webapp ready
deno task --cwd www ready
deno task --cwd sdk ready
deno task --cwd examples/todos ready
```

Documentation-only changes need source review and `git diff --check`, not a full `ready`.

The browser suites run through their own `e2e` tasks, for example `deno task --cwd examples/todos e2e`. They need Playwright browsers and running services, so they stay out of `check`, `test`, `ready`, and CI. Run them locally when you change a flow they cover.

CI runs `ready` for all four projects, compiles and smoke-tests the webapp binary, and runs the deterministic browser specs.

## Pull requests

- Keep diffs small and focused on one change. Split unrelated work into separate pull requests.
- Include a Validation note saying which tasks you ran and what you could not verify.
- Update the affected documentation in the same pull request.
- Do not bump versions or add release tags. Releases are cut by the maintainers.

## Licensing of contributions

This repository is dual licensed. Files under [`www`](www), [`sdk`](sdk), and [`examples`](examples) are under the [MIT License](LICENSE-MIT), and all other files are under the [GNU Affero General Public License v3.0 only](LICENSE-AGPL). Your contribution lands under the license that applies to the files you touch.

AstralBeam also asks contributors to sign a Contributor License Agreement, either the [individual CLA](docs/legal/CLA.md) or, when you contribute on behalf of an employer, the [corporate CLA](docs/legal/CLA-CORPORATE.md). Both are adapted from the Apache CLAs. They grant AstralBeam Inc. a copyright and patent license including the right to sublicense, which is what lets the project ship the same code in the AGPL repository and in the hosted commercial offering. You keep ownership of your contribution.

Signatures are collected when a contribution is proposed, by agreeing to the CLA on the pull request. There is no automation for this in the repository today. [CLA Assistant](https://cla-assistant.io) is the usual GitHub App for collecting signatures automatically, and installing it is a decision for the repository owner.

## Releasing

Releases are maintainer-only. One tag `vX.Y.Z` releases the webapp and the SDK together, and [`.github/workflows/release.yml`](.github/workflows/release.yml) does the work. A tag alone does not put the SDK on npm.

1. Make sure `sdk/package.json` is already at the version you are about to tag. The SDK is the only versioned project, so the workflow fails immediately if the tag and that version disagree.
2. Push the tag, for example `git tag v0.10.0 && git push origin v0.10.0`.
3. The workflow builds the SDK, compiles and smoke-tests the webapp binary, creates the GitHub release with auto-generated notes and the binary attached, and stages the SDK on npm with `npm stage publish`.
4. A maintainer approves the staged package with `npm stage approve <stage-id>`, or from the Staged Packages tab on npmjs.com. Approval prompts for 2FA, and only then is the SDK public. The run's job summary prints the stage id.

Before approving, inspect the staged package with `npm stage list`, `npm stage view <stage-id>`, and `npm stage download <stage-id>`.

Run the workflow manually from the Actions tab with the `dry-run` input to exercise the builds without creating a release or staging anything.

The SDK publishes through [npm trusted publishing](https://docs.npmjs.com/trusted-publishers), so there is no npm token in the repository. The trusted publisher on npmjs.com names this repository and the workflow filename `release.yml` exactly, both case-sensitive. It leaves the "Allowed actions" setting unchecked, which is the stage-only default and keeps the 2FA approval gate in place.
