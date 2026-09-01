import type { SandboxProvider } from "@tanstack/ai-sandbox"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"

import {
  decodeProviderCredentials,
  decodeProviderOptions,
  SandboxConfigurationValidationError,
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
  ) => Effect.Effect<SandboxProvider, SandboxProviderFactoryError>
} = {
  daytona: (configuration: ProviderConfiguration<"daytona">) =>
    loadSandboxProviderModule(() => import("@tanstack/ai-sandbox-daytona")).pipe(
      Effect.map(({ daytonaSandbox }) =>
        daytonaSandbox({ ...configuration.options, ...configuration.credentials })
      ),
    ),
  docker: (configuration: ProviderConfiguration<"docker">) =>
    loadSandboxProviderModule(() => import("@tanstack/ai-sandbox-docker")).pipe(
      Effect.map(({ dockerSandbox }) => dockerSandbox(configuration.options)),
    ),
  sprites: (configuration: ProviderConfiguration<"sprites">) =>
    loadSandboxProviderModule(() => import("@tanstack/ai-sandbox-sprites")).pipe(
      Effect.map(({ spritesSandbox }) =>
        spritesSandbox({ ...configuration.options, ...configuration.credentials })
      ),
    ),
  vercel: (configuration: ProviderConfiguration<"vercel">) =>
    loadSandboxProviderModule(() => import("@tanstack/ai-sandbox-vercel")).pipe(
      Effect.map(({ vercelSandbox }) =>
        vercelSandbox({ ...configuration.options, ...configuration.credentials })
      ),
    ),
}

export class SandboxProviderFactoryError extends Data.TaggedError("SandboxProviderFactoryError")<{
  readonly cause: unknown
}> {}

export function createSandboxProvider<Provider extends SandboxProviderId>(
  provider: Provider,
  configuration: { options: unknown; credentials: unknown },
): Effect.Effect<
  SandboxProvider,
  SandboxConfigurationValidationError | SandboxProviderFactoryError
> {
  return Effect.try({
    try: () =>
      ({
        options: decodeProviderOptions(provider, configuration.options),
        credentials: decodeProviderCredentials(provider, configuration.credentials),
      }) satisfies ProviderConfiguration<Provider>,
    catch: (cause) =>
      cause instanceof SandboxConfigurationValidationError
        ? cause
        : new SandboxProviderFactoryError({ cause }),
  }).pipe(Effect.flatMap(factories[provider]))
}

function loadSandboxProviderModule<Module>(
  load: () => Promise<Module>,
): Effect.Effect<Module, SandboxProviderFactoryError> {
  return Effect.tryPromise({
    try: load,
    catch: (cause) => new SandboxProviderFactoryError({ cause }),
  })
}
