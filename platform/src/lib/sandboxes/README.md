# Sandbox providers

Organization owners and developers can choose Daytona, Docker, E2B, Sprites, or Vercel through the maintained [TanStack AI adapters](https://tanstack.com/ai/latest/docs/sandbox/providers), or Microsandbox through the private workspace's adapter.

Each organization can store multiple named sandbox providers. Cloud provider options remain readable for editing and credentials are encrypted separately. Docker and Microsandbox always use the operator's `LOCAL_SANDBOX_IMAGE`, never an organization-selected image.

Each packaged provider exposes two checks:

- Static `available()` checks host prerequisites without creating a sandbox. External providers return `true` without checking credentials. Docker pings its daemon. Microsandbox runs `doctor` against its installed runtime without pulling an image.
- Instance `valid({ signal })` creates a sandbox, verifies execution, and destroys it. It returns `true` on success or throws on failure. Creation allows two minutes. Execution and cleanup each allow fifteen seconds.

Platform owns authorization, result metadata, and safe error messages. The CLI prints each provider's availability. `DOCKERSANDBOX_DISABLED` and `MICROSANDBOX_DISABLED` accept `true` to disable a runtime or `false` to require it. Unset means automatic detection. Bootstrap downloads `LOCAL_SANDBOX_IMAGE` and runs `valid()` for required runtimes. Startup checks availability only. An unavailable required runtime or failed validation stops the command. Workers inherit the supervisor's checks.

```ts
import { DockerSandbox } from "@astralbeam/sandbox"

if (await DockerSandbox.available()) {
  const connection = new DockerSandbox({ image: "ghcr.io/astralbeamai/sandbox:<version>" })
  await connection.valid()
  const provider = await connection.provider // TanStack SandboxProvider
}
```

| Provider | Package | Stored initializer options | Encrypted credential |
| --- | --- | --- | --- |
| Daytona | [`@tanstack/ai-sandbox-daytona`](https://www.npmjs.com/package/@tanstack/ai-sandbox-daytona) | `target`, `snapshot` | `apiKey` |
| Docker | [`@tanstack/ai-sandbox-docker`](https://www.npmjs.com/package/@tanstack/ai-sandbox-docker) | None | None |
| E2B | [`@tanstack/ai-sandbox-e2b`](https://www.npmjs.com/package/@tanstack/ai-sandbox-e2b) | `template` | `apiKey` |
| Microsandbox | Private workspace adapter | None | None |
| Sprites | [`@tanstack/ai-sandbox-sprites`](https://www.npmjs.com/package/@tanstack/ai-sandbox-sprites) | None | `apiKey` |
| Vercel | [`@tanstack/ai-sandbox-vercel`](https://www.npmjs.com/package/@tanstack/ai-sandbox-vercel) | `teamId`, `projectId`, `runtime` | `token` |

Defaults only populate a new organization form. Once saved, the database values are authoritative and are not replaced or remapped by the factory.

## Daytona setup

1. In the intended [Daytona](https://www.daytona.io/) organization, [create an API key](https://www.daytona.io/docs/api-keys/) with an expiration and the `write:sandboxes` and `delete:sandboxes` permissions. Copy it when shown and store it in a password manager.
2. Choose the `us` or `eu` target and one of the organization's [available snapshots](https://www.daytona.io/docs/snapshots/). `daytona-medium` is the default shown in TanStack's [Daytona example](https://tanstack.com/ai/latest/docs/sandbox/providers#daytona).
3. In the app, open **Sandboxes** from the organization sidebar, add a provider, give it a unique name, choose **Daytona**, enter the target, snapshot, and API key, then select **Test and save**.
4. To rotate the key, test and save its replacement before revoking the previous key.

## Docker setup

1. Install and start [Docker Engine](https://docs.docker.com/engine/install/) or [Docker Desktop](https://docs.docker.com/desktop/).
2. Run the platform directly on that host. As the same operating-system user, run [`docker info`](https://docs.docker.com/reference/cli/docker/system/info/) and resolve any daemon or socket permission error.
3. The adapter connects through `DOCKER_HOST`, or else `~/.docker/run/docker.sock` before `/var/run/docker.sock`, and ignores the CLI's [contexts](https://docs.docker.com/engine/manage-resources/contexts/). With OrbStack, Colima, or a stale Docker Desktop socket, start the platform with `DOCKER_HOST=$(docker context inspect --format '{{.Endpoints.docker.Host}}')` exported.
4. In the app, open **Sandboxes** from the organization sidebar, add a provider, give it a unique name, choose **Docker**, and select **Test and save**. The operator controls the image through `LOCAL_SANDBOX_IMAGE`. Bootstrap saves the release-tagged default to `.env` when unset and downloads missing images into the native caches. Repeat bootstrap runs and normal sandbox creation reuse those caches. Choose a new version tag or digest to prepare another image.

The image installs commands under `/usr/local/bin` and uses the root/home defaults expected by the stock Docker adapter. The adapter is unmodified.

## Microsandbox setup

Follow the [operator setup](../../routes/docs/-content/dashboard/sandboxes.md#microsandbox). Microsandbox is independent of Docker and the database choice.

Microsandbox uses the same operator-owned `LOCAL_SANDBOX_IMAGE` as Docker. Organization image options, including legacy saved selections, are ignored. New organization requests cannot supply them.

[`platform/scripts/microsandbox-runtime.ts`](../../../scripts/microsandbox-runtime.ts) downloads the pinned SDK and native runtime during bootstrap. Startup checks the cached runtime without downloading it. The private workspace adapter accepts only OCI image references, so organization settings cannot select a host directory as the guest filesystem. Vite does not run this CLI preparation.

## E2B setup

1. Create an [E2B API key](https://e2b.dev/docs/quickstart) in the account that should own and pay for the sandboxes.
2. Choose a template name or ID. The default `base` uses E2B's standard environment. Use a custom template when your agent needs additional system tools or libraries.
3. In the app, open **Sandboxes** from the organization sidebar, add a provider, give it a unique name, choose **E2B**, enter the template and API key, then select **Test and save**.
4. E2B's adapter uses a 30-minute sandbox lifetime and destroys expired sandboxes. A later use creates a fresh workspace if the previous sandbox has expired. Test a replacement key before revoking the old key.

## Sprites setup

1. For the Fly.io organization that should own the sandboxes, create an API token at [sprites.dev/account](https://sprites.dev/account) or authenticate with [`sprite org auth`](https://docs.sprites.dev/cli/authentication/).
2. Copy the complete token exactly as issued and store it in a password manager.
3. In the app, open **Sandboxes** from the organization sidebar, add a provider, give it a unique name, choose **Sprites**, enter the token, and select **Test and save**. Test a replacement before revoking an old token.

## Vercel setup

1. Create or choose the Vercel team and project that should own the sandboxes, and confirm that the project can use [Vercel Sandbox](https://vercel.com/docs/sandbox).
2. Create a [Vercel access token](https://vercel.com/account/tokens) scoped to that team. The app accepts a stable access token, not a short-lived Vercel OIDC token.
3. Copy the Team ID from **Team Settings → General** and the Project ID from **Project Settings → General**. A linked project's `.vercel/project.json` contains the same values as `orgId` and `projectId`. Vercel also documents [finding the Team ID](https://vercel.com/docs/accounts#find-your-team-id).
4. In the app, open **Sandboxes** from the organization sidebar, add a provider, give it a unique name, choose **Vercel**, enter those IDs, select `node24`, `node22`, or `python3.13`, enter the access token, and select **Test and save**. Test a replacement before revoking an old token.

## What the chat endpoint does with a provider

A provider on its own runs nothing. Selecting one on an agent is what gives that agent sandbox tools.

The first sandbox tool creates or resumes a workspace scoped by provider connection, agent, conversation, and TenantUser. Active runs retain their leases, and idle sandboxes expire 15 minutes after the last run releases them. Resume state is process-local, so another replica may start a new sandbox. Published files are verified in private storage and attached to their assistant message, so downloads survive sandbox shutdown.

Tools support file writes, paged text reads, listing, commands, and artifact publishing. File reads accept a line offset and a limit of up to 2,000 lines, with 40,000 characters of content per page. Cancellation is passed to filesystem operations, although some providers only check before starting a call.

See the [chat instructions](../chat/AGENTS.md#tools) for lifecycle, scope, path containment, and download implementation.

## Persistence and access

- Sandbox settings and credentials are organization-scoped and may be managed only by organization owners and developers.
- Credentials are encrypted with `DATABASE_ENCRYPTION_KEY` and returned only to authorized organization owners and developers on the no-store sandbox provider page, where they are masked by default and can be revealed for editing.
- **Test and save** creates a real sandbox, runs a harmless command, confirms cleanup, and saves only after success. Vendor or host resource usage may incur cost.
- Changing a saved row to another provider requires new credentials and removes credentials belonging to the previous provider. Create another named row when both configurations should remain available.
