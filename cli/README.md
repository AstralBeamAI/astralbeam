# @astralbeam/cli

Manage an AstralBeam organization's Tenants and TenantUsers, mint short-lived tokens, and test its agents from the terminal. Use `--json` for scripts and coding agents.

## Install

Run it with npm on Node 22.12 or later, with no install step:

```sh
npx @astralbeam/cli --help
```

Or install it globally as `astralbeam`:

```sh
npm install --global @astralbeam/cli
```

Each [GitHub release](https://github.com/AstralBeamAI/astralbeam/releases) also attaches standalone binaries that need no Node, named `astralbeam-<platform>` for `linux-x86_64`, `linux-arm64`, `macos-x86_64`, `macos-arm64`, and `windows-x86_64.exe`. The `releases/latest/download` URL always serves the newest release, so rerunning the download upgrades the CLI.

```sh
curl -fsSLo astralbeam https://github.com/AstralBeamAI/astralbeam/releases/latest/download/astralbeam-macos-arm64
chmod +x astralbeam
mv astralbeam /usr/local/bin/astralbeam
```

**NOTE**: The binaries are not signed. On macOS, a binary downloaded through a browser needs `xattr -d com.apple.quarantine <file>` before its first run.

## Sign in

Create an API key in the dashboard under **API keys**, then log in from the directory where you work on that organization. The prompt hides the pasted key, and piped stdin works too:

```sh
cd ~/work/acme
astralbeam auth login
```

`login` reads the organization's name and slug from the API, which also proves the key works, then binds the key to that directory and everything below it. Bindings live in `~/.config/astralbeam/config.json` (`%APPDATA%\astralbeam` on Windows) with owner-only permissions, never in the directory itself. To manage another organization, log in again from its own directory. For a self-hosted deployment, pass its `/api` base:

```sh
cd ~/work/globex
astralbeam auth login --api-url https://beam.example.com/api
```

Every command then uses the nearest bound directory at or above where it runs, and prints that organization to stderr first, so stdout stays parseable:

```text
▸ Acme (acme) · org 01990a5d-… · bound at ~/work/acme
```

A directory with no bound ancestor fails with exit code 1 instead of guessing an organization. For CI and agents, set `ASTRALBEAM_API_KEY`, which overrides any binding, and `ASTRALBEAM_API_URL` when self-hosting. The URL also overrides a bound key's saved URL. `ASTRALBEAM_CONFIG_DIR` selects the directory containing `config.json`. API URLs require HTTPS, except for HTTP on loopback hosts (`localhost`, IPv4 `127.0.0.0/8`, or `[::1]`).

Check the binding commands will use, or list them all:

```sh
astralbeam auth status
astralbeam auth list
```

## Commands

| Command | Does |
| --- | --- |
| `auth login`, `auth logout`, `auth status`, `auth list` | Bind, unbind, verify, and list directory logins |
| `tenants list`, `get`, `create`, `update` | Manage Tenants |
| `tenant-users list`, `get`, `create`, `update` | Manage a Tenant's users |
| `threads`, `organization` | Read thread directory data and organization details |
| `token chat` | Mint a chat JWT for a Tenant's user, as your token endpoint would |
| `token organization` | Mint an organization-management JWT for a member |
| `chat` | Chat with an agent as a Tenant's user |
| `skill`, `skill install` | Print or install the bundled Agent Skill |

Run `astralbeam <command> --help` for every flag. Tenant lists take `--external-id`, `-q` / `--search`, `--page-size`, `--page-after`, and `--page-before`. TenantUser lists also take `--admin true|false`. Writes also accept `--body '<json>'` or `--body @file.json`. Clear a name with `--body '{"name":null}'`.

Forge's `--dry-run` prints a local JSON request preview without sending HTTP or validating with the server. It reads configuration and supplied `@file` contents.

```sh
astralbeam tenants create --external-id customer-42 --name "Acme Logistics" --metadata '{"plan":"pro"}'
astralbeam tenants list --external-id customer-42 --json
astralbeam tenant-users create <tenant-id> --external-id user-7 --name "Alex Morgan"
astralbeam chat --tenant customer-42 --user user-7 "What can you do?"
```

## Output and exit codes

Human-readable tables and records go to stdout. With `--json`, records and pages stay in API format, and non-interactive operations write one stderr object: `{"context": {...}}` on success or `{"error": {...}, "context": {...}}` on failure. API failures retain their problem details, while runtime and usage errors provide `error.detail`. Help and version output remain plain text. Commands exit with `0` on success, `1` when the API, generated input handling, or runtime fails, and `2` for parser usage errors.

For unexpected failures, use `--debug` to log HTTP methods, URLs, status, duration, and stack traces to stderr, without headers. It adds lines beyond the JSON object. After a failed write, check whether it succeeded before retrying.

## Coding agents

The CLI ships an [Agent Skill](../skills/astralbeam/SKILL.md) for app integration and CLI usage. Let's install it in the current project's `.agents/skills` directory:

```sh
astralbeam skill install
```

Commit `.agents/skills/astralbeam/SKILL.md` to share it with the team and make it available in fresh checkouts. For Claude Code, pass `--dir .claude/skills`. Use `--dir <path>` for another project or a user-level directory. Then give the agent credentials by logging in from the project directory or through `ASTRALBEAM_API_KEY`, never in the prompt.

The full guide is at [astralbeam.ai/docs/cli/getting-started](https://astralbeam.ai/docs/cli/getting-started).
