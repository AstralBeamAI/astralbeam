import type { SandboxProvider } from "@tanstack/ai-sandbox"
import * as Effect from "effect/Effect"

import { SandboxProviderUnavailable } from "./errors.ts"
import {
  decodeProviderCredentials,
  decodeProviderOptions,
  type SandboxProviderCredentials,
  type SandboxProviderId,
  type SandboxProviderOptions,
} from "./schemas.ts"

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
      Effect.map(({ dockerSandbox }) => dockerSandbox(configuration.options)),
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

/** Revalidates the stored configuration and builds the provider's TanStack adapter. */
export const createSandboxProvider = Effect.fn("createSandboxProvider")(function* <
  Provider extends SandboxProviderId,
>(provider: Provider, configuration: { options: unknown; credentials: unknown }) {
  const decoded = yield* Effect.all({
    options: decodeProviderOptions(provider, configuration.options),
    credentials: decodeProviderCredentials(provider, configuration.credentials),
  }).pipe(Effect.mapError((cause) => new SandboxProviderUnavailable({ cause })))
  return yield* factories[provider](decoded)
})

function loadSandboxProviderModule<Module>(
  load: () => Promise<Module>,
): Effect.Effect<Module, SandboxProviderUnavailable> {
  return Effect.tryPromise({
    try: load,
    catch: (cause) => new SandboxProviderUnavailable({ cause }),
  })
}
