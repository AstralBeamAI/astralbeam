# Sandboxes

A sandbox lets an agent run code, analyze files, and create downloads. Connect a provider, then assign it to the agents that need these tools. The provider bills your account for its use.

## Add and verify a provider

1. Open **Sandboxes** and choose **Add provider**.
2. Give it a name, choose a provider, and enter its credentials. Keep its default options unless your provider account needs different values.
3. Choose **Test and save**. Wait for **Provider tested and saved** before continuing.
4. Open an [agent](./agents.md#sandboxes), enable **Sandbox**, select the connection, and save.
5. Ask the agent to create and publish a small text file. Check its command exit code and download the result. See [Sandbox](/docs/sdk/sandbox).

The connection test creates a sandbox, runs a command, and destroys it. It can take time and incur vendor charges.

## Providers and their options

| Provider | What you need                         | Default workspace                 |
| -------- | ------------------------------------- | --------------------------------- |
| Daytona  | API key                               | `daytona-medium` snapshot in `us` |
| Docker   | A daemon reachable by the deployment  | `node:22` image                   |
| E2B      | API key                               | `base` template                   |
| Sprites  | API token                             | No additional options             |
| Vercel   | Access token, Team ID, and Project ID | `node24` runtime                  |

Provider names must be unique within the organization. The form offers the supported regions, images, templates, and runtimes.

## Connection tests

Creating a provider or changing its connection requires a passing test. A failed test leaves the saved settings unchanged.

Re-run the test to diagnose revoked credentials or provider failures. If cleanup fails, check the vendor console for a leftover sandbox.

## Credentials

Credentials are encrypted and accessible only to owners and developers. To rotate one, enter its replacement and choose **Test and save**. The new credential applies to new workspaces. Existing workspaces continue until replaced.

Changing vendors requires the new vendor's credentials and a passing connection test.

## What agents get from a provider

Each agent can use one provider. A workspace starts on its first sandbox tool call and belongs to that agent, conversation, and tenant user.

If the provider configuration cannot be read, the agent answers without sandbox tools. Check the connection when an agent stops offering code execution.

Workspaces are temporary and a shutdown, vendor expiry, or replica change can interrupt a run. Published files remain available through the saved conversation. See [Sandbox](/docs/sdk/sandbox) and [Limits](/docs/sdk/limits).

## Deleting a provider

A provider cannot be deleted while any agent still selects it, so point those agents at a different provider, or at none, first.

Deleting removes the settings and the encrypted credential permanently, and conversations that were using it lose their sandbox tools on their next turn.

## Who can change providers

Owners and developers can manage providers. Viewers cannot access these pages. See [Members](./members.md).
