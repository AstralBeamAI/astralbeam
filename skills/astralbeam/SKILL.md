---
name: astralbeam
description: Integrate AstralBeam AI chat into web applications using its SDK. Use when adding an AstralBeam sidebar or chat screen, connecting application authentication, tools or widgets, or verifying an integration. Also use for AstralBeam CLI tasks involving Tenants, TenantUsers, JWTs, chat, or organization credentials.
license: MIT
---

# AstralBeam

AstralBeam embeds AI chat that can answer questions, call application tools, render UI widgets, and work with files. An AstralBeam Organization owns the agent configuration and API key. Tenants represent your application's customer accounts, and TenantUsers are their users.

To embed chat, follow **Integrate a web application**. The CLI is not required. For CLI-only tasks, skip to **If the CLI is installed**.

## Integrate a web application

1. Inspect the framework, backend, authentication, customer-account model, and intended chat placement. Reuse existing integration code and the host's package manager. A trusted backend must issue tokens. Clarify missing identity or backend requirements rather than putting an API key in browser code.
2. Read [SDK setup](https://astralbeam.ai/docs/sdk/getting-started.md) and [authentication](https://astralbeam.ai/docs/sdk/authentication.md) for installation, token handlers, and SDK examples. Match the installed SDK version. For an app without a bundler, read [script-tag setup](https://astralbeam.ai/docs/sdk/script-tag.md).
3. Confirm the intended Organization and deployment, a working model assigned to the agent, and `ASTRALBEAM_API_KEY` in the backend environment. Have the operator complete missing [dashboard setup](https://astralbeam.ai/docs/start/quickstart.md). CLI login does not configure the application's secret. Continue code and static checks when credentials are unavailable, reporting live verification as pending.
4. Add or reuse `POST /api/astralbeam/token`, returning `{ token }` with `Cache-Control: no-store`. Authenticate the request and derive stable string user and Tenant IDs from the trusted session and verified account membership. Never trust browser-supplied identities or admin claims. Use `createAstralBeamToken` from `@astralbeam/sdk/server`, or the authentication guide's JWT format for other backend languages. Preserve session and CSRF protections, and keep keys and tokens out of logs, prompts, and evidence.
5. Mount `AstralBeamChat` from `@astralbeam/sdk/react` in a client component, or `mountAstralBeamChat` from `@astralbeam/sdk/client` in the browser with teardown via `unmount()`. Give its container a definite height. The default token endpoint is `/api/astralbeam/token`. For a custom endpoint or CSRF headers, follow the authentication guide's `fetchAstralBeamToken` examples. For self-hosting, set `apiUrl` to the issuing deployment's `/api` base.
6. Unmount on sign-out and remount after the trusted session's user or Tenant changes. In React, key chat by Tenant and user IDs. Updating a token callback or clearing the transcript alone does not switch identity. The SDK synchronizes identities through `/me`, so normal embedding needs no CLI pre-creation.
7. Add tools or widgets only when requested. Read [tools and widgets](https://astralbeam.ai/docs/sdk/tools-and-widgets.md) and [security](https://astralbeam.ai/docs/sdk/security.md) before exposing application actions. Reuse existing mutations, validate agent-chosen input, enforce backend ownership checks, and await persistence before returning JSON-compatible results. Demo identities and browser-owned example data are not a production authorization policy.
8. Run the host's relevant checks, sign in, and send a message to confirm the token endpoint and chat work together. If tools or widgets were added, try one representative action and confirm the result in the app. Report any setup or checks still pending.

## If the CLI is installed

Read [CLI commands](https://astralbeam.ai/docs/cli/commands.md) when managing Tenants or TenantUsers, minting tokens, or testing chat. It documents flags, pagination, JSON output, and exit codes. Use `astralbeam <command> --help` for the installed version, or [CLI setup](https://astralbeam.ai/docs/cli/getting-started.md) if it is unavailable. Providers, models, agents, and API keys still require the dashboard.

Run from the intended project directory and check `organization.id` and `api_url` before mutations, token signing, or chat:

```sh
astralbeam auth status --json
astralbeam tenants list --external-id <tenant-external-id> --json
astralbeam chat --tenant <tenant-external-id> --user <user-external-id> "Say hello in one sentence." --json
```

- Use `--json` for machine-readable results. Exit codes are 0 for success, 1 for API/generated-input/runtime failure, and 2 for parser usage errors.
- `ASTRALBEAM_API_KEY` overrides directory bindings. `ASTRALBEAM_API_URL` overrides the saved API URL. Stop on an unintended Organization UUID, deployment, or rejected credentials. Never pass keys as flags or echo them. Interactive `auth login` belongs to the operator. Use existing environment credentials directly, or accept a user-supplied key through stdin.
- Management paths use returned internal UUIDs. Token and chat identities use your application's external IDs. Creates are not idempotent: a timed-out create may still commit. Reconcile the exact external ID and returned fields before retrying a timeout or conflict. Do not change IDs to bypass conflicts. `--metadata` replaces the whole object.
- CLI chat synchronizes identities, makes a new submission on each run, and can incur model usage. It cannot execute browser tools/widgets or replace the in-app setup check. CLI-minted tokens are diagnostics, not application session authentication.
