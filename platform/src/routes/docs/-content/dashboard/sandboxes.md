# Sandboxes

A sandbox provider connects your agents to a code-execution service. Each workspace belongs to one agent, conversation, and tenant user. Cloud providers bill your account for use.

## Add and verify a provider

1. Open **Sandboxes** and choose **Add provider**.
2. Give it a name, choose a provider, and enter the options and credentials listed below.
3. Choose **Test and save**. Wait for **Provider tested and saved** before continuing.
4. Open an [agent](./agents.md#sandboxes), enable **Sandbox**, select the connection, and save.
5. Ask the agent to create and publish a small text file. Check its command exit code and download the result. See [Sandbox](/docs/sdk/sandbox).

The connection test creates a sandbox, runs a command, and destroys it. A cold image pull can take up to two minutes. Cloud providers may charge for use.

## Providers and their options

| Provider | Options | Credential |
| --- | --- | --- |
| Daytona | Target, `us` or `eu`, default `us`. Snapshot, default `daytona-medium`. | API key |
| Docker | Image, default `node:22`. Available when the configured Docker daemon responds. | None |
| E2B | Template name or ID, default `base`. | API key |
| Microsandbox | OCI image, default `python:3.13-slim`. Available when installed and supported by the host. | None |
| Sprites | None. | API token |
| Vercel | Team ID, Project ID, and Runtime, one of `node24`, `node22`, or `python3.13`, default `node24`. | Access token |

Names must be unique within the organization. Docker uses a daemon reachable by the deployment rather than vendor credentials.

## Local providers

Unavailable local providers stay hidden from choices. Existing connections can still be renamed or switched to another provider. Operators can disable local providers through the [environment](../self-hosting/deploy.md#3-set-the-bootstrap-environment).

Check the server startup console for each provider's status. Docker needs a reachable daemon. Microsandbox needs the managed runtime below, even if a separate `msb` command is already installed.

## Microsandbox

Microsandbox runs microVMs on the Platform host without an API key. The host needs Apple Silicon on macOS, accessible KVM on Linux, or Windows 11 with Windows Hypervisor Platform enabled. Windows support is preview.

1. [Install or build Platform](../self-hosting/deploy.md#1-get-a-release-binary) first. Stop it if it is running, then prepare Microsandbox from the same working directory and environment as the server:

   ```sh
   astralbeam-platform bootstrap --microsandbox
   ```

   For a new installation without PostgreSQL, use `bootstrap --embeddedpg --microsandbox` as described in [local setup](../self-hosting/deploy.md#embedded-postgresql). Source builds produce `platform/.output/astralbeam-platform`. Use that executable's path in place of `astralbeam-platform`.

2. Start Platform with `astralbeam-platform start`, keeping the same working directory and data directory. Each startup runs a one-second `msb doctor` check without installing anything. Failed checks leave Microsandbox unavailable while Platform continues booting. This checks host prerequisites. The connection test proves a VM can boot and execute code.
3. Open **Sandboxes → Add provider**, choose **Microsandbox**, and keep `python:3.13-slim` or enter another OCI image. Choose **Test and save**. The first test downloads the image and boots a temporary VM. Then select the saved connection on your [agent](./agents.md#sandboxes) and save its settings.

If Microsandbox is missing from the dropdown, check the startup console for `Sandbox Microsandbox: available` and any host-check failure. Confirm bootstrap and start use the same `ASTRALBEAM_DATA_DIR` and `MICROSANDBOX_DISABLED` is unset. Vite's development server does not run these CLI startup checks.

The default image includes Python and pip, but no Node.js or Office-processing libraries. Agents can install packages inside the VM. For repeatable startup without those downloads, use an image with the tools and libraries your agents need already installed.

Microsandbox is enabled automatically when its installed runtime passes the startup check, unless `MICROSANDBOX_DISABLED=true`. Workspaces have a one-hour maximum lifetime. Snapshots, forks, and port forwarding are unavailable.

The adapter does not configure CPU, memory, disk quotas, or network policy. Review the runtime's effective limits and the host's network controls before offering code execution to untrusted users. Prepare the runtime again with `bootstrap --microsandbox` when a Platform upgrade requires a new runtime version.

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
