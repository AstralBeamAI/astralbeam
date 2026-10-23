# Coding agents

Coding agents such as Claude Code, Codex, and Cursor can use the `astralbeam` CLI through its bundled Agent Skill and JSON output.

## 1. Install the skill

The CLI ships an [Agent Skill](https://agentskills.io) that describes its commands, JSON output, exit codes, and safety rules. Run this command in your project to install it for Claude Code:

```sh
astralbeam skill install
```

It writes `.claude/skills/astralbeam/SKILL.md`, so commit it if your whole team should get it. Pass `--dir ~/.claude/skills` to install it for every project, or `--dir .agents/skills` for agents that read that directory. Run `astralbeam skill` to print the skill without installing it.

Restart the agent session so it loads the skill. The agent then reaches for the CLI when you ask things like "create a tenant for customer-42" or "ask our agent what it can do, as user-7".

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
astralbeam tenant-users list <tenant-id> --external-id user-7 --json
# Only if the TenantUser does not exist:
astralbeam tenant-users create <tenant-id> --external-id user-7 --json
astralbeam chat --tenant customer-42 --user user-7 "Summarize my open orders" --json
```

`chat` is useful for testing an agent's instructions and tools from the terminal after you change them in the dashboard, as any tenant user, without opening your application.

## What it cannot do yet

The public API covers Tenants, TenantUsers, and chat. Agents, API keys, members, sandboxes, and organization settings are managed only in the [dashboard](/docs/dashboard/agents) today, so the CLI cannot change them.
