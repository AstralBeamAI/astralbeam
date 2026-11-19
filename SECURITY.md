# Security Policy

## Reporting a vulnerability

Report vulnerabilities through GitHub's private vulnerability reporting at [Report a vulnerability](https://github.com/AstralBeamAI/astralbeam/security/advisories/new).

Please do not open a public issue, pull request, or Discord message for a suspected vulnerability. Private reporting keeps the details out of public view until a fix is available.

A useful report includes:

- The affected project (`platform`, `website`, `sdk`, `cli`, or `examples`) and the version, tag, or commit you tested.
- Whether you reproduced it against a self-hosted deployment or AstralBeam Cloud.
- Steps to reproduce, the impact you believe it has, and any proof-of-concept code.

## What to expect

- An acknowledgement within 3 business days.
- An initial assessment, including whether we can reproduce it, within 10 business days.
- Updates on the advisory thread as the fix progresses, and credit in the published advisory unless you ask us not to be named.

We are a small team, so these are targets rather than guarantees. If you have not heard back within the acknowledgement window, please add a comment to the advisory thread.

## Supported versions

AstralBeam is pre-1.0. Only the latest published version is supported, which today means the newest `@astralbeam/sdk` release on npm and the current `main` for self-hosted deployments. Security fixes land on `main` and ship in the next release. There are no maintained older release lines and no backports, so upgrade to the latest version before reporting.

## Scope

The code in this repository is in scope, including the platform, website, SDK, CLI, and examples. Issues in third-party dependencies belong to their own maintainers, but tell us if AstralBeam's use of a dependency makes it exploitable here.

## Dependency advisory assessments

Use `bun run audit` for repository dependency checks. Compare resolved versions with upstream security advisories when upgrading dependencies, since registry indexes can lag.

Root overrides replace restrictive transitive dependencies with patched versions: Undici <a href="https://github.com/nodejs/undici/releases/tag/v7.30.2" target="_blank" rel="noopener noreferrer">7.30.2</a>/<a href="https://github.com/nodejs/undici/releases/tag/v8.12.4" target="_blank" rel="noopener noreferrer">8.12.4</a> for Scalar/Miniflare pins, <a href="https://github.com/lxsmnsyc/seroval/releases" target="_blank" rel="noopener noreferrer">Seroval 1.8.1 and seroval-plugins 1.8.0</a> for Solid's `~1.6.8` pins, <a href="https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-qrww-3xmv-qhgm" target="_blank" rel="noopener noreferrer">OpenTelemetry resources 2.12.1</a> for exact pins within the supported 2.x line, and <a href="https://github.com/isaacs/minimatch/security/advisories/GHSA-c859-jr93-m5j4" target="_blank" rel="noopener noreferrer">Minimatch 11.0.8</a> for parents requesting 10.x. Remove each override when its parents permit patched versions and the lockfile retains them without it.
