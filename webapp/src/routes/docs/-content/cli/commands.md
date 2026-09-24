# Commands

This page is the reference for every `astralbeam` command, its output, and its exit codes. `astralbeam <command> --help` prints the same flags from the installed version.

## Global options

| Option      | Effect                                                         |
| ----------- | -------------------------------------------------------------- |
| `--json`    | Print the API's JSON to stdout, and failures as JSON to stderr |
| `--version` | Print the CLI version                                          |

`ASTRALBEAM_API_KEY` wins when it is set, with `ASTRALBEAM_API_URL` or `https://app.astralbeam.ai/api` as its URL. Otherwise the CLI uses the login bound to the nearest directory at or above the working directory, and fails when there is none. Every keyed command reports that organization on stderr, as a leading `▸ <name> (<slug>) · org <id> · bound at <directory>` line, or as `context` in the JSON object with `--json`. API URLs must use `https://`, except for `localhost`. `ASTRALBEAM_CONFIG_DIR` moves the file that holds the bindings.

## auth

| Command | Does |
| --- | --- |
| `auth login [--api-url <url>]` | Read a key from a hidden prompt or stdin, verify it, and bind it to the working directory |
| `auth logout` | Remove the binding that covers the working directory |
| `auth status` | Show the organization, API URL, and bound directory, and verify the key |
| `auth list` | List every bound directory and its organization |

The CLI never takes a key as a flag, so it cannot leak into shell history or process listings. `login` and `status` store the organization's name and slug as the API reports them, and `status` refreshes them after a rename.

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

Updates change only the fields you pass. `--metadata` takes a JSON object and replaces the stored object whole. The stored admin flag is data and grants no API authority. See [Authentication](/docs/api#description/authentication).

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

In table mode, the CLI prints the next `--page-after` value on stderr when more results remain. `--all` spends one request per page against the key's limit of 100 requests per 5 minutes.

## token

| Command | Does |
| --- | --- |
| `token chat --tenant <external-id> --user <external-id>` | Mint a chat JWT, as your [token endpoint](/docs/sdk/authentication) would |
| `token organization --email <email>` | Mint an organization-management JWT delegating a member's current role |

`token chat` also takes `--tenant-name`, `--user-name`, and `--admin`, which signs `user.admin: true`. Both take `--expires-in <seconds>`, from 60 to 600 and 300 by default. Tokens are signed offline with your key, so minting one makes no request and creates no records.

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

Without `--json`, lists print as tables and records as `key value` lines. With `--json`, stdout carries exactly what the API returned: a record, or a page with `items`, `page_after`, and `page_before`. `token` prints `{ "token", "expires_at" }`, and `chat` prints `{ "messages": [...] }` with the turn's user and assistant messages.

Failures always go to stderr. With `--json`, stderr holds exactly one JSON object: `{"context": {...}}` on success, or `{"error": {...}, "context": {...}}` on failure, where `error` holds the API's problem details with `status`, `title`, `detail`, and any field `issues`. `context` is `{ "organization", "bound_directory" }`, with `bound_directory` null for `ASTRALBEAM_API_KEY`, and `context` itself is null when a command uses no credentials or failed before resolving them.

| Exit code | Meaning                                                            |
| --------- | ------------------------------------------------------------------ |
| `0`       | Success                                                            |
| `1`       | The API rejected the request, or the network or credentials failed |
| `2`       | Invalid usage, such as a missing flag or malformed JSON            |
