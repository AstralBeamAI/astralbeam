# Commands

Look up commands, output formats, and exit codes here. For flags supported by your installed version, run `astralbeam <command> --help`. See [Getting started](./getting-started.md) for installation and login.

## Global options

| Option      | Effect                                                         |
| ----------- | -------------------------------------------------------------- |
| `--json`    | Print the API's JSON to stdout, and failures as JSON to stderr |
| `--debug`   | Log each HTTP request and a failure's stack trace to stderr    |
| `--version` | Print the CLI version                                          |

`ASTRALBEAM_API_KEY` overrides directory bindings, using `ASTRALBEAM_API_URL` or `https://astralbeam.ai/api`. Otherwise the nearest bound directory supplies both the key and URL. Keyed commands report the organization on stderr, or in JSON `context`. HTTPS is required except for HTTP on loopback hosts (`localhost`, IPv4 `127.0.0.0/8`, or `[::1]`). `ASTRALBEAM_CONFIG_DIR` selects the directory holding `config.json`.

## auth

| Command | Does |
| --- | --- |
| `auth login [--api-url <url>]` | Read a key from a hidden prompt or stdin, verify it, and bind it to the working directory |
| `auth logout` | Remove the binding that covers the working directory |
| `auth status` | Show the organization, API URL, and bound directory, and verify the key |
| `auth list` | List every bound directory and its organization |

The CLI never takes a key as a flag, so it cannot leak into shell history or process listings. `login` and `status` store the organization's name and slug as the API reports them, and `status` refreshes them after a rename.

`logout` removes the nearest binding for every directory it covers. It does not revoke the key or clear `ASTRALBEAM_API_KEY`, which still takes precedence.

## tenants

| Command | Does |
| --- | --- |
| `tenants list` | List Tenants in internal ID order |
| `tenants get <id>` | Show one Tenant |
| `tenants create --external-id <id> [--name <name>] [--metadata <json>]` | Create a Tenant |
| `tenants update <id> [--name <name> \| --clear-name] [--metadata <json>]` | Update a Tenant |

## tenant-users

| Command | Does |
| --- | --- |
| `tenant-users list <tenant-id> [--admin \| --no-admin]` | List a Tenant's users, optionally by stored admin flag |
| `tenant-users get <tenant-id> <id>` | Show one TenantUser |
| `tenant-users create <tenant-id> --external-id <id> [--name <name>] [--admin] [--metadata <json>]` | Create a TenantUser |
| `tenant-users update <tenant-id> <id> [--name <name> \| --clear-name] [--admin \| --no-admin] [--metadata <json>]` | Update a TenantUser |

Updates change only supplied fields. `--metadata` replaces the entire stored JSON object. The stored admin flag is data and grants no API authority. See [Authentication](/docs/api#description/authentication).

## Listing options

Both `list` commands take the same options, which map onto the API's [pagination](/docs/api#description/pagination):

| Option                   | Effect                                                     |
| ------------------------ | ---------------------------------------------------------- |
| `-q, --search <text>`    | Case-insensitive substring of the name or external ID      |
| `--external-id <id>`     | Exact external ID, returning zero or one item              |
| `--page-size <count>`    | Items per page, 20 by default and capped at 100            |
| `--page-after <cursor>`  | Continue after a previous page's `page_after`              |
| `--page-before <cursor>` | Go back from a previous page's `page_before`               |
| `--all`                  | Follow `page_after` to the last page and return every item |

In table mode, the CLI prints the next `--page-after` value on stderr when more results remain. `--all` merges pages from the chosen starting cursor, using 100 items per request unless `--page-size` is set. It cannot be combined with `--page-before` and spends one request per page against the key's limit of 100 requests per 5 minutes.

## token

| Command | Does |
| --- | --- |
| `token chat --tenant <external-id> --user <external-id>` | Mint a chat JWT, as your [token endpoint](/docs/sdk/authentication) would |
| `token organization --email <email>` | Mint an organization-management JWT delegating a member's current role |

`token chat` also takes `--tenant-name`, `--user-name`, and `--admin`, which signs `user.admin: true` and grants Tenant admin API access. Both token commands take `--expires-in <seconds>`, from 60 to 600 and 300 by default. Tokens are signed offline with your key, so minting one makes no request and creates no records.

## chat

```sh
astralbeam chat --tenant <external-id> --user <external-id> [--agent <agent-id>] [message]
```

`chat` runs one turn with the message argument, or with stdin when it is piped, and otherwise opens an interactive prompt that `/exit` closes. It uses the organization's default agent unless `--agent agent_<organizationId>_<id>` names another. Like the widget, it synchronizes the signed Tenant and TenantUser records through `POST /api/v1/me` before chatting. The identity flags match `token chat`.

The CLI implements no host tools or widgets. A tool the agent calls on the client side is announced on stderr and settled as an error before the next message.

## skill

| Command | Does |
| --- | --- |
| `skill` | Print the bundled Agent Skill, as `{ "content" }` with `--json` |
| `skill install [--dir <path>]` | Write it to `<path>/astralbeam/SKILL.md`, `.claude/skills` by default |

See [Coding agents](./coding-agents.md).

## Output and exit codes

Without `--json`, lists print as tables, records as `key value` lines, tokens as plain JWTs, and chat replies as streamed text. With `--json`, records and pages retain the API format, with `--all` merging pages into one. Tokens print `{ "token", "expires_at" }` and chat prints `{ "messages": [...] }` for the turn. JSON chat requires a message argument or piped stdin.

With `--json`, non-interactive operations write one stderr object: `{"context": {...}}` on success or `{"error": {...}, "context": {...}}` on failure. API errors retain their problem details. Runtime and usage errors provide `error.detail`. Help and version output remain plain text. `--debug` adds HTTP logs and stack traces, so omit it when parsing stderr as JSON.

Context contains `organization` and `bound_directory`, or is null before credentials resolve or for commands that use none. Environment credentials have a null bound directory and report only `organization.id`, except in `auth status`, which also retrieves the name and slug. Directory bindings include the last saved name and slug.

| Exit code | Meaning                                                            |
| --------- | ------------------------------------------------------------------ |
| `0`       | Success                                                            |
| `1`       | The API rejected the request, or the network or credentials failed |
| `2`       | Invalid usage, such as a missing flag or malformed JSON            |
