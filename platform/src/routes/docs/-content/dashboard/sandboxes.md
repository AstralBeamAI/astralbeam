# Sandboxes

A sandbox lets an agent run code, analyze files, and create downloads. Connect a provider, then assign it to the agents that need these tools. Cloud providers bill your account for use.

## Add and verify a provider

1. Open **Sandboxes** and choose **Add provider**.
2. Give it a name, choose a provider, and enter any required credentials. Keep its default options unless your provider account needs different values.
3. Choose **Test and save**. Wait for **Provider tested and saved** before continuing.
4. Open an [agent](./agents.md#sandboxes), enable **Sandbox**, select the connection, and save.
5. Ask the agent to create and publish a small text file. Check its command exit code and download the result. See [Sandbox](/docs/sdk/sandbox).

The connection test creates a sandbox, runs a command, and destroys it. Creation has a two-minute timeout, including any image download. Cloud providers may charge for use.

## Providers and their options

| Provider | What you need                         | Default workspace                 |
| -------- | ------------------------------------- | --------------------------------- |
| Daytona  | API key                               | `daytona-medium` snapshot in `us` |
| Docker   | A daemon reachable by the deployment  | Operator-selected image           |
| E2B      | API key                               | `base` template                   |
| Microsandbox | A prepared runtime and supported host | Operator-selected image        |
| Sprites  | API token                             | No additional options             |
| Vercel   | Access token, Team ID, and Project ID | `node24` runtime                  |

Provider names must be unique within the organization. Cloud-provider forms offer the supported regions, templates, and runtimes.

Docker and Microsandbox use the operator's `LOCAL_SANDBOX_IMAGE`. The default is `ghcr.io/astralbeamai/sandbox` tagged with the Platform version. It includes Node.js, TypeScript, Python, Git, and tools for Office files, PDFs, and OCR. Organization members cannot change this image.

## Local providers

Docker and Microsandbox appear in the provider choices only when their host checks pass. If a provider becomes unavailable, you can still rename its saved connections or switch them to another provider.

Check the startup console for each provider's status. Docker needs a reachable daemon. Microsandbox needs the runtime prepared by Platform, even if a separate `msb` command is installed. Run `astralbeam-platform --help` for the environment settings that disable or require each local provider.

## Microsandbox

Microsandbox runs microVMs on the Platform host without Docker or an API key. It works with either external or embedded PostgreSQL.

The host needs Apple Silicon on macOS, access to KVM on Linux, or Windows 11 with Windows Hypervisor Platform enabled. Windows support is preview. On a VPS or inside another VM, the host must expose hardware virtualization to Platform.

To add it to an existing deployment:

1. [Install or build the Platform binary](../self-hosting/deploy.md#other-binary-installations). Stop Platform before continuing. Keep the existing database URL and encryption key when adding Microsandbox to an existing deployment.
2. From the server's working directory, prepare the SDK and native runtime once:

   ```sh
   astralbeam-platform bootstrap --microsandbox
   ```

   Bootstrap also initializes missing settings and applies pending migrations. For a new local installation, follow [standalone setup](../self-hosting/deploy.md).

3. Start Platform from the same directory, with the same environment and `ASTRALBEAM_DATA_DIR`:

   ```sh
   astralbeam-platform start
   ```

   Look for `Sandbox Microsandbox: available` in the console. Startup checks the prepared runtime and host without downloading a runtime or image.

4. [Add and verify a provider](#add-and-verify-a-provider), choosing **Microsandbox**. The connection test verifies that a VM can boot and execute code. Select the saved connection on your agent to give it sandbox tools.

**NOTE**: Source builds produce `platform/.output/astralbeam-platform`. Use that path in place of `astralbeam-platform`. Vite's development server does not run the native host checks, so use the Platform binary to try Microsandbox.

### Image and dependencies

Bootstrap downloads the operator-selected image when missing and reuses its cache on later runs. See [local sandbox image configuration](../self-hosting/deploy.md#local-sandbox-image). Agents can install additional Python packages inside their workspace.

### If Microsandbox is unavailable

1. Read the startup console's host-check failure. Check that the host exposes the required virtualization support.
2. Confirm that bootstrap and start use the same data directory and operating-system user. If an upgrade requires a new runtime version, stop Platform and run `bootstrap --microsandbox` again.
3. Check that `MICROSANDBOX_DISABLED` is not `true`. An installed runtime is detected automatically. If it is required through `MICROSANDBOX_DISABLED=false`, a failed check stops startup.

### Runtime limits

Workspaces have a one-hour maximum lifetime. Snapshots, forks, and port forwarding are unavailable.

The adapter does not configure CPU, memory, disk quotas, or network policy. Review the runtime's effective limits and the host's network controls before offering code execution to untrusted users.

## Connection tests

Creating a provider or changing its connection requires a passing test. A failed test leaves the saved settings unchanged.

Re-run the test to diagnose revoked credentials or provider failures. If cleanup fails, check the vendor console for a leftover sandbox.

## Credentials

Credentials are encrypted and accessible only to owners and developers. To rotate one, enter its replacement and choose **Test and save**. The new credential applies to new workspaces. Existing workspaces continue until replaced.

Changing providers clears the old credential. Enter any credentials the new provider needs and choose **Test and save**.

## What agents get from a provider

Each agent can use one provider. A workspace starts on its first sandbox tool call and belongs to that agent, conversation, and tenant user.

If the provider configuration cannot be read, the agent answers without sandbox tools. Check the connection when an agent stops offering code execution.

Workspaces are temporary and a shutdown, vendor expiry, or replica change can interrupt a run. Published files remain available through the saved conversation. See [Sandbox](/docs/sdk/sandbox) and [Limits](/docs/sdk/limits).

## Deleting a provider

A provider cannot be deleted while an agent selects it. First, select another provider on each affected agent or disable its sandbox tools.

Deleting permanently removes the settings and encrypted credential. Conversations that used the provider lose its sandbox tools on their next turn.

## Who can change providers

Owners and developers can manage providers. Viewers cannot access these pages. See [Members](./members.md).
