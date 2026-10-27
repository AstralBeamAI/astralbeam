# Sandboxes

A sandbox provider connects your agents to a code-execution service. Each workspace belongs to one agent, conversation, and tenant user. The vendor bills your account for its use.

## Add and verify a provider

1. Open **Sandboxes** and choose **Add provider**.
2. Give it a name, choose a vendor, and enter the options and credentials listed below.
3. Choose **Test and save**. Wait for **Provider tested and saved** before continuing.
4. Open an [agent](./agents.md#sandboxes), enable **Sandbox**, select the connection, and save.
5. Ask the agent to create and publish a small text file. Check its command exit code and download the result. See [Sandbox](/docs/sdk/sandbox).

The connection test creates a sandbox, runs a command, and destroys it. It can take time and incur vendor charges.

## Providers and their options

| Provider | Options | Credential |
| --- | --- | --- |
| Daytona | Target, `us` or `eu`, default `us`. Snapshot, default `daytona-medium`. | API key |
| Docker | Image, default `node:22`. | None |
| E2B | Template name or ID, default `base`. | API key |
| Sprites | None. | API token |
| Vercel | Team ID, Project ID, and Runtime, one of `node24`, `node22`, or `python3.13`, default `node24`. | Access token |

Names must be unique within the organization. Docker uses a daemon reachable by the deployment rather than vendor credentials.

## Connection tests

Creating a provider or changing its connection settings requires a passing test. A failed test leaves stored settings unchanged. Renaming needs no test.

Re-run the test to diagnose revoked credentials or provider failures. If cleanup fails, check the vendor console for a leftover sandbox.

## Credentials

Credentials are stored encrypted and are revealed only to owners and developers, for editing, as viewers cannot reach these pages at all.

A rotated credential applies to sandboxes provisioned after the save, so a conversation whose sandbox is already running is not disturbed until that sandbox is replaced.

Changing a provider's vendor discards the stored credential, because a credential means nothing to a different vendor. Enter the new vendor's credential and let the test verify it before the change is stored.

## What agents get from a provider

An organization can keep several providers and assign different ones to its agents. Workspaces are provisioned on the first sandbox tool call. See [Agents](./agents.md).

If the provider configuration cannot be read, the agent answers without sandbox tools. Check the connection when an agent stops offering code execution.

Workspaces are temporary and a shutdown, vendor expiry, or replica change can interrupt a run. Published files remain available through the saved conversation. See [Sandbox](/docs/sdk/sandbox) and [Limits](/docs/sdk/limits).

## Deleting a provider

A provider cannot be deleted while any agent still selects it, so point those agents at a different provider, or at none, first.

Deleting removes the settings and the encrypted credential permanently, and conversations that were using it lose their sandbox tools on their next turn.

## Who can change providers

Owners and developers can read, save, test, and delete provider configurations, and viewers have no access to them. See [Members](./members.md).
