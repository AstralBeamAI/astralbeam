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

Create an API key in the dashboard under **API keys**, then store it in a profile. The prompt hides the pasted key, and piped stdin works too:

```sh
astralbeam auth login
astralbeam auth login --profile self-hosted --api-url https://beam.example.com/api
```

`login` verifies the key against the API before writing it to `~/.config/astralbeam/config.json` (`%APPDATA%\astralbeam` on Windows) with owner-only permissions. For CI and agents, set `ASTRALBEAM_API_KEY` instead and nothing is stored.

| Setting | Precedence |
| --- | --- |
| Credentials | `--profile`, then `ASTRALBEAM_API_KEY`, then `ASTRALBEAM_PROFILE`, then the `default` profile |
| API URL | `ASTRALBEAM_API_URL`, then the profile's URL, then `https://app.astralbeam.ai/api` |
| Config directory | `ASTRALBEAM_CONFIG_DIR`, then the platform default above |

Check which credentials commands will use:

```sh
astralbeam auth status
```

## Commands

| Command | Does |
| --- | --- |
| `auth login`, `auth logout`, `auth status` | Store, delete, and verify profiles |
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

Pass `--dir ~/.claude/skills` to install it for every project, or `--dir .agents/skills` for agents that read that directory. Then give the agent credentials through `ASTRALBEAM_API_KEY` or a stored profile, never in the prompt.

The full guide is at [app.astralbeam.ai/docs/cli/getting-started](https://app.astralbeam.ai/docs/cli/getting-started).
