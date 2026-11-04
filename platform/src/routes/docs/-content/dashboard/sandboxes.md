# Sandboxes

A sandbox provider connects your agents to a code-execution service. Each workspace belongs to one agent, conversation, and tenant user. Cloud providers bill your account for use.

## Add and verify a provider

1. Open **Sandboxes** and choose **Add provider**.
2. Give it a name, choose a provider, and enter the options and credentials listed below.
3. Choose **Test and save**. Wait for **Provider tested and saved** before continuing.
4. Open an [agent](./agents.md#sandboxes), enable **Sandbox**, select the connection, and save.
5. Ask the agent to create and publish a small text file. Check its command exit code and download the result. See [Sandbox](/docs/sdk/sandbox).

The connection test creates a sandbox, runs a command, and destroys it. Creation has a two-minute timeout, including any image download. Cloud providers may charge for use.

## Providers and their options

| Provider | Options | Credential |
| --- | --- | --- |
| Daytona | Target, `us` or `eu`, default `us`. Snapshot, default `daytona-medium`. | API key |
| Docker | Operator-selected image. Available when the configured Docker daemon responds. | None |
| E2B | Template name or ID, default `base`. | API key |
| Microsandbox | Operator-selected image. Available when installed and supported by the host. | None |
| Sprites | None. | API token |
| Vercel | Team ID, Project ID, and Runtime, one of `node24`, `node22`, or `python3.13`, default `node24`. | Access token |

Names must be unique within the organization. Docker uses a daemon reachable by the deployment rather than vendor credentials.

Docker and Microsandbox use the image selected by the deployment operator through `LOCAL_SANDBOX_IMAGE`. The default is `ghcr.io/astralbeamai/sandbox` tagged with the Platform version and includes Node.js LTS, TypeScript, Python, Git, Office/PDF libraries, and English OCR. Organization members cannot select another image.

## Local providers

Docker and Microsandbox appear in the provider choices only when their host checks pass. If a provider becomes unavailable, you can still rename its saved connections or switch them to another provider.

Check the startup console for each provider's status. Docker needs a reachable daemon. Microsandbox needs the runtime prepared by Platform, even if a separate `msb` command is already installed. To disable either provider, set its [environment variable](../self-hosting/deploy.md#3-set-the-bootstrap-environment) and restart Platform.

## Microsandbox

Microsandbox runs microVMs on the Platform host. It needs neither Docker nor an API key and works with either external or embedded PostgreSQL. Platform still requires PostgreSQL 18 or later.

The host needs Apple Silicon on macOS, access to KVM on Linux, or Windows 11 with Windows Hypervisor Platform enabled. Windows support is preview. On a VPS or inside another VM, the host must expose hardware virtualization to Platform.

Let's prepare the runtime, then verify it with a real VM:

1. [Install or build the Platform binary](../self-hosting/deploy.md#1-get-a-release-binary). Stop Platform before continuing. Keep the existing database URL and encryption key when adding Microsandbox to an existing deployment.
2. From the server's working directory, prepare the SDK and native runtime once:

   ```sh
   astralbeam-platform bootstrap --microsandbox
   ```

   Bootstrap also initializes missing Platform settings and applies pending database migrations. For a new installation without a database server, use `astralbeam-platform bootstrap --embeddedpg --microsandbox` as described in [embedded PostgreSQL setup](../self-hosting/deploy.md#embedded-postgresql).

3. Start Platform from the same directory, with the same environment and `ASTRALBEAM_DATA_DIR`:

   ```sh
   astralbeam-platform start
   ```

   Look for `Sandbox Microsandbox: available` in the console. Startup runs `msb doctor` with a one-second timeout. It checks host prerequisites without downloading a runtime or image. If the check fails, Platform continues with Microsandbox unavailable.

4. [Add and verify a provider](#add-and-verify-a-provider), choosing **Microsandbox**. The connection test verifies that a VM can boot and execute code. Select the saved connection on your agent to give it sandbox tools.

**NOTE**: Source builds produce `platform/.output/astralbeam-platform`. Use that path in place of `astralbeam-platform`. Vite's development server does not run the native host checks, so use the Platform binary to try Microsandbox.

### Image and dependencies

The operator sets one image for Docker and Microsandbox in `.env`. Bootstrap pre-downloads it and refreshes the cache on later runs. See [local sandbox image configuration](../self-hosting/deploy.md#local-sandbox-image). Agents can also install additional Python packages inside their workspace.

### If Microsandbox is unavailable

1. Read the startup console's host-check failure. Check that the host exposes the required virtualization support.
2. Confirm that bootstrap and start use the same data directory and operating-system user. If an upgrade requires a new runtime version, stop Platform and run `bootstrap --microsandbox` again.
3. Check that `MICROSANDBOX_DISABLED` is not `true`. No enablement flag is needed after bootstrap. The installed runtime becomes available automatically when its startup check passes.

### Runtime limits

Workspaces have a one-hour maximum lifetime. Snapshots, forks, and port forwarding are unavailable.

The adapter does not configure CPU, memory, disk quotas, or network policy. Review the runtime's effective limits and the host's network controls before offering code execution to untrusted users.

## Connection tests

Creating a provider or changing its connection settings requires a passing test. A failed test leaves stored settings unchanged. Renaming needs no test.

Re-run the test to diagnose revoked credentials or provider failures. If cleanup fails, check the vendor console for a leftover sandbox.

## Credentials

Credentials are encrypted in the database. Owners and developers can reveal them for editing. Viewers cannot access these pages.

A rotated credential applies when the next sandbox is created. Running sandboxes keep their current connection until they are replaced.

Changing the provider type clears the old credential. Enter the new provider's credential and choose **Test and save**.

## What agents get from a provider

An organization can keep several providers and assign different ones to its agents. Workspaces are provisioned on the first sandbox tool call. See [Agents](./agents.md).

If the provider configuration cannot be read, the agent answers without sandbox tools. Check the connection when an agent stops offering code execution.

Workspaces are temporary and a shutdown, vendor expiry, or replica change can interrupt a run. Published files remain available through the saved conversation. See [Sandbox](/docs/sdk/sandbox) and [Limits](/docs/sdk/limits).

## Deleting a provider

A provider cannot be deleted while an agent selects it. First, select another provider on each affected agent or disable its sandbox tools.

Deleting permanently removes the settings and encrypted credential. Conversations that used the provider lose its sandbox tools on their next turn.

## Who can change providers

Owners and developers can read, save, test, and delete provider configurations. Viewers have no access. See [Members](./members.md).
