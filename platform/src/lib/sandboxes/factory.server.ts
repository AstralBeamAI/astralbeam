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
    module: typeof import("@astralbeam/sandbox"),
    configuration: ProviderConfiguration<Provider>,
  ) => SandboxProvider
} = {
  daytona: ({ daytonaSandbox }, configuration) =>
    daytonaSandbox({ ...configuration.options, ...configuration.credentials }),
  docker: ({ dockerSandbox }, configuration) =>
    dockerSandbox({ ...configuration.options, keepAliveCommand: DOCKER_KEEP_ALIVE_COMMAND }),
  e2b: ({ e2bSandbox }, configuration) =>
    e2bSandbox({ ...configuration.options, ...configuration.credentials }),
  sprites: ({ spritesSandbox }, configuration) =>
    spritesSandbox({ ...configuration.options, ...configuration.credentials }),
  vercel: ({ vercelSandbox }, configuration) =>
    vercelSandbox({ ...configuration.options, ...configuration.credentials }),
}

/** Builds the TanStack adapter from the configuration validated by its caller. */
export const createSandboxProvider = Effect.fn("createSandboxProvider")(
  <Provider extends SandboxProviderId>(
    provider: Provider,
    configuration: ProviderConfiguration<Provider>,
  ) =>
    Effect.tryPromise({
      try: () => import("@astralbeam/sandbox"),
      catch: (cause) => new SandboxProviderUnavailable({ cause }),
    }).pipe(Effect.map((module) => factories[provider](module, configuration))),
)

export class SandboxProviderFactory extends Context.Service<
  SandboxProviderFactory,
  { readonly create: typeof createSandboxProvider }
>()("astralbeam/sandboxes/SandboxProviderFactory") {
  static readonly layer = Layer.succeed(SandboxProviderFactory, { create: createSandboxProvider })
}
