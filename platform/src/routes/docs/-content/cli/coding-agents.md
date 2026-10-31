# Coding agents

For app integration, give your coding agent the [AstralBeam skill](/agent-skills/astralbeam/SKILL.md). The CLI is not required.

To manage Tenants and TenantUsers or test chat from the terminal, use the CLI's bundled copy of the same skill and JSON output. [Install the CLI](./getting-started.md#1-install-the-cli) first.

## 1. Install the skill

The CLI ships an [Agent Skill](https://agentskills.io) for app integration and CLI usage. Run this command from your repository root to install it for agents that read `.agents/skills`, including Codex:

```sh
astralbeam skill install
```

It writes `.agents/skills/astralbeam/SKILL.md` in the current directory. Commit this file so it is present in your team's checkouts and cloud workspaces. For Claude Code, pass `--dir .claude/skills`. Use `--dir <path>` for another project or a user-level directory. Run `astralbeam skill` to print the skill without installing it.

Restart the agent session so it loads the skill. Then ask it to use the CLI, for example "create a tenant for customer-42" or "ask our agent what it can do, as user-7".

Skill installers supporting [website discovery](https://github.com/cloudflare/agent-skills-discovery-rfc) can use [astralbeam.ai](https://astralbeam.ai) as the source. Repository-based installers can use the [skill directory](https://github.com/AstralBeamAI/astralbeam/tree/main/skills/astralbeam).

## 2. Give the agent credentials

Run `astralbeam auth login` yourself in the agent's project directory, or supply `ASTRALBEAM_API_KEY` in its environment. Never paste a key into the prompt or pass one as a command-line flag. The skill checks the resolved organization with `astralbeam auth status --json` before writes and keeps keys out of output.

**NOTE**: An organization API key can create and update every Tenant and TenantUser, and can sign chat tokens as any of them. Give an agent a dedicated key you can delete, and prefer a staging organization or a self-hosted deployment for experiments. See [API keys](/docs/dashboard/api-keys).

## What the agent can do

The agent can use the operations in [Commands](./commands.md), with JSON and exit codes for automation. After verifying the organization, look up the Tenant first. Create it only if the lookup is empty, then use its returned internal UUID for TenantUser commands:

```sh
astralbeam auth status --json
astralbeam tenants list --external-id customer-42 --json
# Only if the Tenant does not exist:
astralbeam tenants create --external-id customer-42 --name "Acme Logistics" --json
astralbeam tenant-users list --tenant-id <tenant-id> --external-id user-7 --json
# Only if the TenantUser does not exist:
astralbeam tenant-users create <tenant-id> --external-id user-7 --json
astralbeam chat --tenant customer-42 --user user-7 "Summarize my open orders" --json
```

Use `chat` to test dashboard instructions and server-side tools as a tenant user. The CLI cannot execute your application's browser tools or widgets.

## What it cannot do yet

The public API covers Tenants, TenantUsers, and chat. Agents, API keys, members, sandboxes, and organization settings are managed only in the [dashboard](/docs/dashboard/agents) today, so the CLI cannot change them.
