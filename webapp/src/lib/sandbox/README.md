# Sandbox providers

Organization owners and developers can choose Daytona, Docker, Sprites, or Vercel. Each uses a maintained adapter from the official [TanStack AI sandbox provider list](https://tanstack.com/ai/latest/docs/sandbox/providers); E2B, Deno Sandbox, and other providers are outside this initial set.

Each organization can store multiple named sandbox providers, including multiple configurations for the same vendor. Public initializer options remain readable for editing, credentials are encrypted separately, and the factory passes both to the corresponding TanStack initializer without renaming or reinterpretation.

| Provider | Package                                                                                      | Stored initializer options       | Encrypted credential |
| -------- | -------------------------------------------------------------------------------------------- | -------------------------------- | -------------------- |
| Daytona  | [`@tanstack/ai-sandbox-daytona`](https://www.npmjs.com/package/@tanstack/ai-sandbox-daytona) | `target`, `snapshot`             | `apiKey`             |
| Docker   | [`@tanstack/ai-sandbox-docker`](https://www.npmjs.com/package/@tanstack/ai-sandbox-docker)   | `image`                          | None                 |
| Sprites  | [`@tanstack/ai-sandbox-sprites`](https://www.npmjs.com/package/@tanstack/ai-sandbox-sprites) | None                             | `apiKey`             |
| Vercel   | [`@tanstack/ai-sandbox-vercel`](https://www.npmjs.com/package/@tanstack/ai-sandbox-vercel)   | `teamId`, `projectId`, `runtime` | `token`              |

Defaults only populate a new organization form. Once saved, the database values are authoritative and are not replaced or remapped by the factory.

## Daytona setup

1. In the intended [Daytona](https://www.daytona.io/) organization, [create an API key](https://www.daytona.io/docs/api-keys/) with an expiration and the `write:sandboxes` and `delete:sandboxes` permissions. Copy it when shown and store it in a password manager.
2. Choose the `us` or `eu` target and one of the organization's [available snapshots](https://www.daytona.io/docs/snapshots/). `daytona-medium` is the default shown in TanStack's [Daytona example](https://tanstack.com/ai/latest/docs/sandbox/providers#daytona).
3. In the app, open **Sandbox providers** from the organization sidebar, add a provider, give it a unique name, choose **Daytona**, enter the target, snapshot, and API key, then select **Test and save**.
4. To rotate the key, test and save its replacement before revoking the previous key.

The factory calls `daytonaSandbox({ ...storedOptions, apiKey })`. TanStack owns sandbox creation, resume, snapshots, cleanup, capabilities, and SDK defaults.

## Docker setup

1. Install and start [Docker Engine](https://docs.docker.com/engine/install/) or [Docker Desktop](https://docs.docker.com/desktop/).
2. Run the webapp directly on that host. As the same operating-system user, run [`docker info`](https://docs.docker.com/reference/cli/docker/system/info/) and resolve any daemon or socket permission error.
3. In the app, open **Sandbox providers** from the organization sidebar, add a provider, give it a unique name, choose **Docker**, enter a trusted image, and select **Test and save**. The default is the TanStack-documented `node:22`; Docker pulls it when absent.

The factory calls `dockerSandbox(storedOptions)` and otherwise leaves the provider defaults unchanged. Do not expose an unauthenticated Docker API or use untrusted images.

## Sprites setup

1. For the Fly.io organization that should own the sandboxes, create an API token at [sprites.dev/account](https://sprites.dev/account) or authenticate with [`sprite org auth`](https://docs.sprites.dev/cli/authentication/).
2. Copy the complete token exactly as issued and store it in a password manager.
3. In the app, open **Sandbox providers** from the organization sidebar, add a provider, give it a unique name, choose **Sprites**, enter the token, and select **Test and save**. Test a replacement before revoking an old token.

The factory calls `spritesSandbox({ apiKey })` and leaves the provider's control-plane URL, working directory, public URL authentication, and port defaults unchanged.

## Vercel setup

1. Create or choose the Vercel team and project that should own the sandboxes, and confirm that the project can use [Vercel Sandbox](https://vercel.com/docs/sandbox).
2. Create a [Vercel access token](https://vercel.com/account/tokens) scoped to that team. The app accepts a stable access token, not a short-lived Vercel OIDC token.
3. Copy the Team ID from **Team Settings → General** and the Project ID from **Project Settings → General**. A linked project's `.vercel/project.json` contains the same values as `orgId` and `projectId`; Vercel also documents [finding the Team ID](https://vercel.com/docs/accounts#find-your-team-id).
4. In the app, open **Sandbox providers** from the organization sidebar, add a provider, give it a unique name, choose **Vercel**, enter those IDs, select `node24`, `node22`, or `python3.13`, enter the access token, and select **Test and save**. Test a replacement before revoking an old token.

The factory calls `vercelSandbox({ teamId, projectId, runtime, token })` with the stored values. Keep token scope narrow and set an expiration appropriate for your deployment.

## Persistence and access

- Sandbox settings and credentials are organization-scoped and may be managed only by organization owners and developers.
- Credentials are encrypted with `DATABASE_ENCRYPTION_KEY` and returned only to authorized organization owners and developers on the no-store sandbox provider page, where they are masked by default and can be revealed for editing.
- **Test and save** creates a real sandbox, runs a harmless command, confirms cleanup, and saves only after success; vendor or host resource usage may incur cost.
- Changing a saved row to another provider requires new credentials and removes credentials belonging to the previous provider. Create another named row when both configurations should remain available.
