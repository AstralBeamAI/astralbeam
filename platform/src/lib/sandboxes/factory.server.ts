import type { SandboxProvider } from "@tanstack/ai-sandbox"
import { Context, Effect, Layer } from "effect"

import { SandboxProviderUnavailable } from "./errors.ts"
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
    configuration: ProviderConfiguration<Provider>,
  ) => Effect.Effect<SandboxProvider, SandboxProviderUnavailable>
} = {
  daytona: (configuration: ProviderConfiguration<"daytona">) =>
    loadSandboxProviderModule(() => import("@tanstack/ai-sandbox-daytona")).pipe(
      Effect.map(({ daytonaSandbox }) =>
        daytonaSandbox({ ...configuration.options, ...configuration.credentials }),
      ),
    ),
  docker: (configuration: ProviderConfiguration<"docker">) =>
    loadSandboxProviderModule(() => import("@tanstack/ai-sandbox-docker")).pipe(
      Effect.map(({ dockerSandbox }) =>
        dockerSandbox({ ...configuration.options, keepAliveCommand: DOCKER_KEEP_ALIVE_COMMAND }),
      ),
    ),
  e2b: (configuration: ProviderConfiguration<"e2b">) =>
    loadSandboxProviderModule(() => import("@tanstack/ai-sandbox-e2b")).pipe(
      Effect.map(({ e2bSandbox }) =>
        e2bSandbox({ ...configuration.options, ...configuration.credentials }),
      ),
    ),
  sprites: (configuration: ProviderConfiguration<"sprites">) =>
    loadSandboxProviderModule(() => import("@tanstack/ai-sandbox-sprites")).pipe(
      Effect.map(({ spritesSandbox }) =>
        spritesSandbox({ ...configuration.options, ...configuration.credentials }),
      ),
    ),
  vercel: (configuration: ProviderConfiguration<"vercel">) =>
    loadSandboxProviderModule(() => import("@tanstack/ai-sandbox-vercel")).pipe(
      Effect.map(({ vercelSandbox }) =>
        vercelSandbox({ ...configuration.options, ...configuration.credentials }),
      ),
    ),
}

/** Builds the TanStack adapter from the configuration validated by its caller. */
export const createSandboxProvider = Effect.fn("createSandboxProvider")(
  <Provider extends SandboxProviderId>(
    provider: Provider,
    configuration: ProviderConfiguration<Provider>,
  ) => factories[provider](configuration),
)

export class SandboxProviderFactory extends Context.Service<
  SandboxProviderFactory,
  { readonly create: typeof createSandboxProvider }
>()("astralbeam/sandboxes/SandboxProviderFactory") {
  static readonly layer = Layer.succeed(SandboxProviderFactory, { create: createSandboxProvider })
}

function loadSandboxProviderModule<Module>(
  load: () => Promise<Module>,
): Effect.Effect<Module, SandboxProviderUnavailable> {
  return Effect.tryPromise({
    try: load,
    catch: (cause) => new SandboxProviderUnavailable({ cause }),
  })
}
