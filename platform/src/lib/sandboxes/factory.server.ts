import type { SandboxConnection } from "@astralbeam/sandbox"
import process from "node:process"
import { Context, Effect, Layer } from "effect"

import { SandboxProviderUnavailable } from "./errors.ts"
import { getAvailableSandboxProviderIds } from "./availability.server.ts"
import { getLocalSandboxImage } from "./image.server.ts"
import type {
  SandboxProviderCredentials,
  SandboxProviderId,
  SandboxProviderOptions,
} from "./schemas.ts"

// `tail` as PID 1 ignores SIGTERM, so without the trap every destroy waits out Docker's stop timeout.
const DOCKER_KEEP_ALIVE_COMMAND = ["sh", "-c", "trap 'exit 0' TERM; tail -f /dev/null & wait"]

type ProviderConfiguration<Provider extends SandboxProviderId> = {
  options: SandboxProviderOptions[Provider]
  credentials: SandboxProviderCredentials[Provider]
}

const factories: {
  [Provider in SandboxProviderId]: (
    module: typeof import("@astralbeam/sandbox"),
    configuration: ProviderConfiguration<Provider>,
  ) => SandboxConnection | Promise<SandboxConnection>
} = {
  daytona: ({ DaytonaSandbox }, configuration) =>
    new DaytonaSandbox({ ...configuration.options, ...configuration.credentials }),
  docker: async ({ DockerSandbox }) => {
    if (!(await getAvailableSandboxProviderIds()).includes("docker"))
      throw new Error("Docker is not available on this server")
    return new DockerSandbox({
      image: getLocalSandboxImage(),
      keepAliveCommand: DOCKER_KEEP_ALIVE_COMMAND,
    })
  },
  e2b: ({ E2BSandbox }, configuration) =>
    new E2BSandbox({ ...configuration.options, ...configuration.credentials }),
  microsandbox: ({ Microsandbox }) => {
    const sdkPath = process.env.__ASTRALBEAM_INTERNAL_MICROSANDBOX_SDK
    if (!sdkPath) throw new Error("Microsandbox is not enabled on this server")
    return new Microsandbox({ image: getLocalSandboxImage(), sdkPath })
  },
  sprites: ({ SpritesSandbox }, configuration) =>
    new SpritesSandbox({ ...configuration.options, ...configuration.credentials }),
  vercel: ({ VercelSandbox }, configuration) =>
    new VercelSandbox({ ...configuration.options, ...configuration.credentials }),
}

/** Builds a configured connection and resolves its TanStack adapter. */
export const createSandboxProvider = Effect.fn("createSandboxProvider")(
  <Provider extends SandboxProviderId>(
    provider: Provider,
    configuration: ProviderConfiguration<Provider>,
  ) =>
    Effect.tryPromise({
      try: async () => {
        const connection = await factories[provider](
          await import("@astralbeam/sandbox"),
          configuration,
        )
        await connection.provider
        await connection.resourceScope
        return connection
      },
      catch: (cause) => new SandboxProviderUnavailable({ cause }),
    }),
)

export class SandboxProviderFactory extends Context.Service<
  SandboxProviderFactory,
  { readonly create: typeof createSandboxProvider }
>()("astralbeam/sandboxes/SandboxProviderFactory") {
  static readonly layer = Layer.succeed(SandboxProviderFactory, { create: createSandboxProvider })
}
