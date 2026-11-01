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

Use `bun run audit` for repository dependency checks. It excludes only the advisory assessed below. Raw `bun audit` still reports the registry entry, and Bun's `--json` output remains unfiltered even with `--ignore`.

- **GHSA-gcqx-w48m-w2h4 / CVE-2026-93753, Deepmerge 4.3.1: not applicable to current AstralBeam usage, reviewed 2026-11-01.** The <a href="https://github.com/TehShrike/deepmerge/issues/273" target="_blank" rel="noopener noreferrer">upstream discussion disputes the vulnerability classification</a>, while the <a href="https://github.com/advisories/GHSA-gcqx-w48m-w2h4" target="_blank" rel="noopener noreferrer">advisory remains published</a>. The reported behavior affects the returned object's prototype rather than global `Object.prototype`, so its security impact depends on how callers use untrusted input. After upgrading `@react-email/render` to 2.2, Deepmerge is reachable only through Shadcn's developer CLI and its registry tooling. AstralBeam application code does not import those packages or use their merged objects for authentication, authorization, or tenant data. Developer-selected registry content is already trusted to supply source code and dependencies. Do not report this existing dependency-only finding as an actionable AstralBeam vulnerability while those conditions hold. Remove the audit exclusion and reassess if Deepmerge gains an application runtime consumer, lower-trust input crosses a security boundary through its output, or new evidence changes the impact. Remove the exclusion when the dependency disappears or the advisory is withdrawn.
