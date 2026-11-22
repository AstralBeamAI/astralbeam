# Security Policy

## Reporting a vulnerability

Report vulnerabilities through GitHub's private vulnerability reporting at [Report a vulnerability](https://github.com/AstralBeamAI/astralbeam/security/advisories/new).

Please do not open a public issue, pull request, or Discord message for a suspected vulnerability. Private reporting keeps the details out of public view until a fix is available.

A useful report includes:

- The affected project (`platform`, `website`, `sdk`, `cli`, or `examples`) and the version, tag, or commit you tested.
- Whether you reproduced it against a self-hosted deployment or AstralBeam Cloud.
- Steps to reproduce, the impact you believe it has, and any proof-of-concept code.
- Your starting role or access and any relevant agent settings or integrations.

Use accounts and test data you control. Redact secrets and customer data from any evidence.

## What to expect

- An acknowledgement within 3 business days.
- An initial assessment, including whether we can reproduce it, within 10 business days.
- Updates on the advisory thread as the fix progresses, and credit in the published advisory unless you ask us not to be named.

We are a small team, so these are targets rather than guarantees. If you have not heard back within the acknowledgement window, please add a comment to the advisory thread.

Coordinate public disclosure with us in the advisory thread. Find published advisories on <a href="https://github.com/AstralBeamAI/astralbeam/security/advisories" target="_blank" rel="noopener noreferrer">GitHub</a>.

## Supported versions

AstralBeam is pre-1.0. Only the latest published version is supported, which today means the newest `@astralbeam/sdk` release on npm and the current `main` for self-hosted deployments. Security fixes land on `main` and ship in the next release. There are no maintained older release lines and no backports, so upgrade to the latest version before reporting.

## Scope

The code in this repository is in scope, including the platform, website, SDK, CLI, and examples. Issues in third-party dependencies belong to their own maintainers, but tell us if AstralBeam's use of a dependency makes it exploitable here.

AstralBeam Cloud is also in scope. Report issues confined to host apps or connected services to their maintainers.

## Threat model

AstralBeam adds an agent sidebar to an existing web app. An Organization is an AstralBeam customer. A Tenant is one of that Organization's customers, and a TenantUser uses the embedded agent.

We consider unauthenticated callers, anyone trying to exceed their granted access, and anyone who can influence what the agent reads. Treat browser input, prompts, files, tool results, and model output as untrusted.

### Which boundaries does AstralBeam enforce?

- **Identity and access.** Report bypasses of Organization or Tenant isolation, conversation permissions, or the scope of a dashboard role, chat token, API key, or operator session. Authorized dashboard members and Tenant administrators can read saved conversations within their scopes.
- **Agent tools and output.** Report unauthorized tool use, access to another user's private MCP connection, credential exposure, or script execution through SDK-rendered content. For prompt injection, show an unauthorized disclosure or action, or a bypass of a control AstralBeam enforces.
- **Files and sandboxes.** Report unauthorized access to uploads, generated files, or other workspaces, or escapes from supported sandboxes.
- **Availability and usage.** Report disproportionate disruption or shared cost from limited activity, or a bypass of an enforced limit. Model calls already in flight can finish beyond the allowance. See [Usage limits](platform/src/routes/docs/-content/dashboard/usage-limits.md).

### What do we rely on?

- **Host apps** authenticate users and verify Tenant membership before minting short-lived chat tokens with a server-held Organization API key. They validate widget inputs and authorize tool actions on their backend, such as checking the signed-in user's permission to refund an order in their Tenant. See the [SDK security model](platform/src/routes/docs/-content/sdk/security.md).
- **Self-hosted operators** protect the host, deployment secrets, database, and storage, and configure HTTPS, trusted proxies, and access to `/configure`. See [Self-hosting security](platform/src/routes/docs/-content/self-hosting/security.md).
- **Configured providers** are trusted with the data and credentials needed for their assigned role. Their responses remain untrusted.

### How we triage

We triage by starting access, failed boundary, and impact. Optional AstralBeam security controls are in scope when enabled. Reports without a demonstrated security impact can still lead to hardening fixes.

## Dependency advisory assessments

Use `bun run audit` for repository dependency checks. Compare resolved versions with upstream security advisories when upgrading dependencies, since registry indexes can lag.

Root overrides replace restrictive transitive dependencies with patched versions: Undici <a href="https://github.com/nodejs/undici/releases/tag/v7.30.2" target="_blank" rel="noopener noreferrer">7.30.2</a>/<a href="https://github.com/nodejs/undici/releases/tag/v8.12.4" target="_blank" rel="noopener noreferrer">8.12.4</a> for Scalar/Miniflare pins, <a href="https://github.com/lxsmnsyc/seroval/releases" target="_blank" rel="noopener noreferrer">Seroval 1.8.1 and seroval-plugins 1.8.0</a> for Solid's `~1.6.8` pins, <a href="https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-qrww-3xmv-qhgm" target="_blank" rel="noopener noreferrer">OpenTelemetry resources 2.12.1</a> for exact pins within the supported 2.x line, and <a href="https://github.com/isaacs/minimatch/security/advisories/GHSA-c859-jr93-m5j4" target="_blank" rel="noopener noreferrer">Minimatch 11.0.8</a> for parents requesting 10.x. Remove each override when its parents permit patched versions and the lockfile retains them without it.
