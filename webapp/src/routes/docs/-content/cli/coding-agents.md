# Coding agents

Coding agents such as Claude Code, Codex, and Cursor can run the `astralbeam` CLI for you. Let's teach one the commands with the bundled Agent Skill, give it credentials safely, and look at what it can and cannot do.

## 1. Install the skill

The CLI ships an [Agent Skill](https://agentskills.io) that describes its commands, JSON output, exit codes, and safety rules. Run this command in your project to install it for Claude Code:

```sh
astralbeam skill install
```

It writes `.claude/skills/astralbeam/SKILL.md`, so commit it if your whole team should get it. Pass `--dir ~/.claude/skills` to install it for every project, or `--dir .agents/skills` for agents that read that directory. Run `astralbeam skill` to print the skill without installing it.

Restart the agent session so it loads the skill. The agent then reaches for the CLI when you ask things like "create a tenant for customer-42" or "ask our agent what it can do, as user-7".

## 2. Give the agent credentials

Never paste an API key into a prompt, where it lands in the transcript. Give the agent's shell the key instead, through a profile you stored with `astralbeam auth login` or through `ASTRALBEAM_API_KEY` in its environment. The skill tells the agent to check them with `astralbeam auth status --json`, and never to print a key or pass one as a flag.

**NOTE**: An organization API key can create and update every Tenant and TenantUser, and can sign chat tokens as any of them. Give an agent a dedicated key you can delete, and prefer a staging organization or a self-hosted deployment for experiments. See [API keys](/docs/dashboard/api-keys).

## What the agent can do

The agent can do everything in [Commands](./commands.md). Because every command takes `--json` and reports failures through exit codes, it can chain lookups, creates, and chats without scraping tables. A typical provisioning run looks like this:

```sh
astralbeam tenants list --external-id customer-42 --json
astralbeam tenants create --external-id customer-42 --name "Acme Logistics" --json
astralbeam tenant-users create <tenant-id> --external-id user-7 --json
astralbeam chat --tenant customer-42 --user user-7 "Summarize my open orders" --json
```

`chat` is useful for testing an agent's instructions and tools from the terminal after you change them in the dashboard, as any tenant user, without opening your application.

## What it cannot do yet

The public API covers Tenants, TenantUsers, and chat. Agents, API keys, members, sandboxes, and organization settings are managed only in the [dashboard](/docs/dashboard/agents) today, so the CLI cannot change them.
