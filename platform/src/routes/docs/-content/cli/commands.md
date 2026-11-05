# Commands

Look up commands, output formats, and exit codes here. For flags supported by your installed version, run `astralbeam <command> --help`. See [Getting started](./getting-started.md) for installation and login.

## Global options

| Option      | Effect                                                         |
| ----------- | -------------------------------------------------------------- |
| `--json`    | Print the API's JSON to stdout, and failures as JSON to stderr |
| `--debug`   | Log each HTTP request and a failure's stack trace to stderr    |
| `--version` | Print the CLI version                                          |

Set `ASTRALBEAM_API_KEY` for CI or use a [saved login](#auth) locally. Environment credentials take precedence, and `ASTRALBEAM_API_URL` overrides the saved URL. The default API is `https://astralbeam.ai/api`. Other deployments require HTTPS, except for HTTP on loopback hosts.

## auth

| Command | Does |
| --- | --- |
| `auth login [--api-url <url>]` | Read a key from a hidden prompt or stdin, verify it, and bind it to the working directory |
| `auth logout` | Remove the binding that covers the working directory |
| `auth status` | Show the organization, API URL, and bound directory, and verify the key |
| `auth list` | List every bound directory and its organization |

Credentials live in `~/.config/astralbeam/config.json`, or `%APPDATA%\astralbeam\config.json` on Windows, outside your repository. Set `ASTRALBEAM_CONFIG_DIR` to use another configuration directory. The CLI reads keys from a hidden prompt, stdin, or the environment, never a flag.

`logout` removes the nearest binding for every directory it covers. It does not revoke the key or clear `ASTRALBEAM_API_KEY`, which still takes precedence.

## tenants

| Command                             | Does                                                 |
| ----------------------------------- | ---------------------------------------------------- |
| `tenants list`                      | List Tenants in internal ID order                    |
| `tenants get <id>`                  | Show one Tenant                                      |
| `tenants create --external-id <id>` | Create a Tenant, optionally with a name and metadata |
| `tenants update <id>`               | Update a Tenant's name or metadata                   |

## tenant-users

| Command                                              | Does                  |
| ---------------------------------------------------- | --------------------- |
| `tenant-users list --tenant-id <tenant-id>`          | List a Tenant's users |
| `tenant-users get <id> --tenant-id <tenant-id>`      | Show one TenantUser   |
| `tenant-users create <tenant-id> --external-id <id>` | Create a TenantUser   |
| `tenant-users update <id> --tenant-id <tenant-id>`   | Update a TenantUser   |

Use `--name` and `--metadata` for profile fields, and command `--help` for other options. Updates change only supplied fields. `--metadata` replaces the entire stored JSON object. The stored admin flag grants no API authority. See [Authentication](/docs/api#description/authentication).

## Listing options

Tenant and TenantUser `list` commands take the same options, which map onto the API's [pagination](/docs/api#description/pagination):

| Option                   | Effect                                                |
| ------------------------ | ----------------------------------------------------- |
| `-q, --search <text>`    | Case-insensitive substring of the name or external ID |
| `--external-id <id>`     | Exact external ID, returning zero or one item         |
| `--page-size <count>`    | Items per page, 20 by default and capped at 100       |
| `--page-after <cursor>`  | Continue after a previous page's `page_after`         |
| `--page-before <cursor>` | Go back from a previous page's `page_before`          |

In table mode, the CLI prints the next `--page-after` value on stderr when more results remain. Each call returns one page.

Both create and update accept `--body '<json>'` or `--body @file.json` instead of individual body flags. Clear a name with `--body '{"name":null}'`.

For generated API commands, `--dry-run` previews the request without sending it. This reads local configuration and any supplied `@file`, but does not validate against the server.

## Organization, conversations, and usage

Read organization details, saved conversations, and TenantUser usage through commands generated from the API:

| Command | Does |
| --- | --- |
| `organization get` | Show the authenticated organization's ID, name, and slug |
| `threads list [--tenant-id <id>] [--search <text>]` | List saved conversations, optionally filtered by Tenant or title |
| `tenants threads messages list --tenant-id <id> --id <thread-id>` | Read a saved conversation's messages |
| `tenant-users usage get <tenant-id> --user-ids <ids> --start <time> --end <time>` | Read users' usage in USD over a time range |

Use the internal UUIDs returned by the API. Conversation lists and message history accept the [listing options](#listing-options). Reading history does not make you a conversation participant. Usage takes up to 100 comma-separated user UUIDs and timezone-qualified ISO 8601 timestamps over a positive range of at most 93 days. The start is inclusive and the end exclusive.

## token

| Command | Does |
| --- | --- |
| `token chat --tenant <external-id> --user <external-id>` | Mint a chat JWT, as your [token endpoint](/docs/sdk/authentication) would |
| `token organization --email <email>` | Mint an organization-management JWT delegating a member's current role |

Tokens last five minutes by default and are signed locally, without creating records. Run the command with `--help` for identity and expiry options. Use `token chat --admin` only for a trusted Tenant administrator, since it grants admin API access.

## chat

```sh
astralbeam chat --tenant <external-id> --user <external-id> [--agent <agent-id>] [message]
```

Pass a message or pipe one through stdin for a single turn. Omit both for interactive chat, and use `/exit` to leave. Chat uses the default agent unless you pass `--agent`, and synchronizes the Tenant and TenantUser before sending.

The CLI implements no host tools or widgets. A tool the agent calls on the client side is announced on stderr and settled as an error before the next message.

## skill

| Command | Does |
| --- | --- |
| `skill` | Print the bundled Agent Skill, as `{ "content" }` with `--json` |
| `skill install [--dir <path>]` | Write it to `<path>/astralbeam/SKILL.md`, `.agents/skills` in the current project by default |

See [Coding agents](./coding-agents.md).

## Output and exit codes

Without `--json`, lists print as tables, records as `key value` lines, tokens as plain JWTs, and chat replies as streamed text. With `--json`, records and pages retain the API format. Tokens print `{ "token", "expires_at" }` and chat prints `{ "messages": [...] }` for the turn. JSON chat requires a message argument or piped stdin.

Non-interactive JSON operations write one stderr object: `{"context": {...}}` on success or `{"error": {...}, "context": {...}}` on failure. Context identifies the organization and bound directory. API errors retain their problem details, while runtime and usage errors provide `error.detail`. Help and version output stay plain text.

Use `auth status --json` to verify the organization before an automated write. Omit `--debug` when parsing stderr as JSON, since it adds HTTP logs and stack traces. After a timeout or failed write, check the result before retrying.

| Exit code | Meaning                                                            |
| --------- | ------------------------------------------------------------------ |
| `0`       | Success                                                            |
| `1`       | The API, generated input handling, network, or credentials failed  |
| `2`       | Parser usage errors, such as an unknown flag or missing positional |
