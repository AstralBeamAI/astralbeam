# Coding agents

## Integrate your app

Ask your coding agent to use the [AstralBeam skill](/agent-skills/astralbeam/SKILL.md) in your app's repository. The CLI is not required.

First, [connect a model and create an API key](/docs/start/quickstart#1-create-an-api-key). Keep the key in your backend's environment, never in the prompt.

## Use the CLI

To manage Tenants and TenantUsers or test chat from the terminal, use the CLI's bundled copy of the same skill and JSON output. [Install the CLI](./getting-started.md#1-install-the-cli) first.

### 1. Install the skill

From your repository root, install the bundled [Agent Skill](https://agentskills.io) for Codex or another assistant that reads `.agents/skills`:

```sh
astralbeam skill install
```

It writes `.agents/skills/astralbeam/SKILL.md`. Review and commit the file to share it with your team. For Claude Code, use `astralbeam skill install --dir .claude/skills`. Run `astralbeam skill` to inspect the contents before installation.

Restart the assistant's session to load the skill.

You can also install from [astralbeam.ai](https://astralbeam.ai) with a tool that supports [website discovery](https://github.com/cloudflare/agent-skills-discovery-rfc), or from the [skill's repository directory](https://github.com/AstralBeamAI/astralbeam/tree/main/skills/astralbeam).

### 2. Give the agent credentials

Run `astralbeam auth login` yourself in the agent's project directory, or supply `ASTRALBEAM_API_KEY` in its environment. Never paste a key into the prompt or pass one as a command-line flag. The skill checks the resolved organization with `astralbeam auth status --json` before writes and keeps keys out of output.

**NOTE**: An organization API key can create and update every Tenant and TenantUser, and can sign chat tokens as any of them. Give an agent a dedicated key you can delete, and prefer a staging organization or a self-hosted deployment for experiments. See [API keys](/docs/dashboard/api-keys).

### What the agent can do

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

### What it cannot do yet

Configure agents, model providers, keys, and members in the [dashboard](/docs/dashboard/agents). The CLI cannot change dashboard settings.
