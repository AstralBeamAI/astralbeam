---
name: astralbeam
description: Manage an AstralBeam organization from the terminal with the `astralbeam` CLI. Use when asked to list, look up, create, or update AstralBeam Tenants or TenantUsers, mint AstralBeam chat or organization JWTs, test an AstralBeam agent by chatting as a tenant user, or check which AstralBeam API key and URL are configured.
---

# AstralBeam CLI

`astralbeam` calls an AstralBeam organization's public API with an organization API key. Tenants are the organization's customers, and TenantUsers are those customers' users who talk to the embedded agent.

If `astralbeam` is not on the PATH, run it as `npx -y @astralbeam/cli` instead.

## Rules

- Pass `--json` on every command whose output you will read. Records and pages go to stdout. Stderr then holds exactly one JSON object: `{"context": {...}}` on success, or `{"error": {...}, "context": {...}}` on failure, where `error` carries the API's `status`, `detail`, and optional `issues`. `context` is `{"organization": {"id", "name", "slug"}, "bound_directory": <path or null>}`, or `null` when the command uses no credentials or failed before resolving them.
- Exit code 0 means success, 1 means the API or runtime failed, and 2 means the command line was invalid. Read `astralbeam <command> --help` before guessing flags. To diagnose an unexpected failure, rerun it without `--json` and with `--debug`, which logs each HTTP request and the stack trace to stderr.
- Never print, log, or echo an API key. Never pass a key as a command-line argument. Credentials come from `ASTRALBEAM_API_KEY`, or from the nearest directory at or above the working directory where someone ran `astralbeam auth login`. Run commands from the project directory the user means, because a different directory can select a different organization.
- Before any write, run `astralbeam auth status --json` from the same directory and confirm `organization` is the one the user means. Stop if it is not. Without `--json`, keyed commands print the organization first on stderr as `▸ Acme (acme) · org <id> · bound at ~/work/acme`.
- Never run `astralbeam auth login` yourself unless the user supplies the key through stdin or the environment. It prompts for a secret.
- Path IDs are internal UUIDs returned by the API. External IDs are the organization's own identifiers and are passed with `--external-id`, `--tenant`, or `--user`.
- Creates are not idempotent. A duplicate external ID returns HTTP 409. After a timeout or a 409, look the record up with `list --external-id <id>` before retrying.
- `--metadata` replaces the whole stored object and must be a JSON object.
- The management API allows 100 requests per 5 minutes per key. Prefer `--external-id` lookups over `--all` listings, and back off on HTTP 429.

## Check credentials

```sh
astralbeam auth status --json
```

This prints the organization's ID, name, and slug, the API URL, and the bound directory, and fails with exit code 1 when no login covers the directory or the key is malformed, revoked, or pointed at the wrong server. `astralbeam auth list --json` shows every bound directory and its organization.

## Tenants

```sh
astralbeam tenants list --json [--search <text>] [--external-id <id>] [--page-size <n>] [--page-after <cursor>] [--all]
astralbeam tenants get <tenant-id> --json
astralbeam tenants create --external-id <id> [--name <name>] [--metadata '<json>'] --json
astralbeam tenants update <tenant-id> [--name <name> | --clear-name] [--metadata '<json>'] --json
```

A list returns `{"items": [...], "page_after": <cursor|null>, "page_before": <cursor|null>}`. Pass `page_after` back with `--page-after` for the next page, and stop when it is `null`.

## TenantUsers

```sh
astralbeam tenant-users list <tenant-id> --json [--external-id <id>] [--admin | --no-admin] [--all]
astralbeam tenant-users get <tenant-id> <user-id> --json
astralbeam tenant-users create <tenant-id> --external-id <id> [--name <name>] [--admin] [--metadata '<json>'] --json
astralbeam tenant-users update <tenant-id> <user-id> [--name <name> | --clear-name] [--admin | --no-admin] [--metadata '<json>'] --json
```

To find a user from external IDs, resolve the Tenant first with `tenants list --external-id <tenant-external-id> --json`, then list its users with `--external-id <user-external-id>`. The stored `admin` flag is data and grants no API authority.

## Tokens

```sh
astralbeam token chat --tenant <tenant-external-id> --user <user-external-id> [--admin] [--expires-in <60-600>] --json
astralbeam token organization --email <member-email> [--expires-in <60-600>] --json
```

Tokens are signed offline with the API key and print as `{"token": "...", "expires_at": "..."}`. A chat token is what the organization's token endpoint returns to the embedded SDK. It does not create the Tenant or TenantUser.

## Chat with an agent

```sh
astralbeam chat --tenant <tenant-external-id> --user <user-external-id> "<message>" --json
echo "<message>" | astralbeam chat --tenant <id> --user <id> --agent <agent-id> --json
```

Chat signs a token for that identity and runs the organization's default agent, or the agent named by `--agent agent_<organizationId>_<id>`. It synchronizes the Tenant and TenantUser records the same way the embedded widget does. With `--json` it prints `{"messages": [...]}`, the turn's user and assistant messages with their `parts`. Text is in parts of type `text`, and tool calls are in parts of type `tool-call`. The CLI implements no client-side tools, so it settles any such call as an error before the next message.
