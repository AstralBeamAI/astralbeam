# @astralbeam/cli

Manage an AstralBeam organization from the terminal: its Tenants and TenantUsers, short-lived chat and organization tokens, and test chats with its agents. Every command prints JSON with `--json`, so coding agents such as Claude Code can drive it too.

```sh
npx @astralbeam/cli --help
```

## Install

Run it with npm on Node 22.12 or later, with no install step:

```sh
npx @astralbeam/cli tenants list
```

Or install it globally as `astralbeam`:

```sh
npm install --global @astralbeam/cli
```

Each [GitHub release](https://github.com/AstralBeamAI/astralbeam/releases) also attaches standalone binaries that need no Node, named `astralbeam-v<version>-<platform>` for `linux-x86_64`, `linux-arm64`, `macos-x86_64`, `macos-arm64`, and `windows-x86_64.exe`.

```sh
gh release download v0.12.0 --repo AstralBeamAI/astralbeam --pattern 'astralbeam-v0.12.0-macos-arm64'
chmod +x astralbeam-v0.12.0-macos-arm64
mv astralbeam-v0.12.0-macos-arm64 /usr/local/bin/astralbeam
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

A directory with no bound ancestor fails with exit code 1 instead of guessing an organization. For CI and agents, set `ASTRALBEAM_API_KEY`, which overrides any binding, and `ASTRALBEAM_API_URL` when self-hosting. API URLs must use `https://`, except for `localhost`.

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
| `token chat` | Mint a chat JWT for a Tenant's user, as your token endpoint would |
| `token organization` | Mint an organization-management JWT for a member |
| `chat` | Chat with an agent as a Tenant's user |
| `skill`, `skill install` | Print or install the bundled Agent Skill |

Run `astralbeam <command> --help` for every flag. Lists take `--search`, `--external-id`, `--page-size`, `--page-after`, `--page-before`, and `--all`.

```sh
astralbeam tenants create --external-id customer-42 --name "Acme Logistics" --metadata '{"plan":"pro"}'
astralbeam tenants list --external-id customer-42 --json
astralbeam tenant-users create <tenant-id> --external-id user-7 --name "Alex Morgan"
astralbeam chat --tenant customer-42 --user user-7 "What can you do?"
```

## Output and exit codes

Human-readable tables and records go to stdout. With `--json`, stdout carries the API's JSON and failures reach stderr as `{"error": {...}}`, holding the API's problem details. Commands exit with `0` on success, `1` when the API or runtime fails, and `2` for invalid usage.

## Coding agents

The CLI ships an [Agent Skill](skills/astralbeam/SKILL.md) that teaches an agent its commands, JSON output, and safety rules. Let's install it for Claude Code in the current project:

```sh
astralbeam skill install
```

Pass `--dir ~/.claude/skills` to install it for every project, or `--dir .agents/skills` for agents that read that directory. Then give the agent credentials by logging in from the project directory or through `ASTRALBEAM_API_KEY`, never in the prompt.

The full guide is at [app.astralbeam.ai/docs/cli/getting-started](https://app.astralbeam.ai/docs/cli/getting-started).
