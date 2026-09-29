import { Context, Effect, Layer } from "effect"

import type { ConfigValues } from "@/lib/config/types"
import { EmailDeliveryError } from "./errors.ts"

// Seam: reads the process-cached global configuration until the shared Config service replaces it.
// Loaded on use, because the config store imports `@/db`, which imports the app runtime.
export class EmailConfig extends Context.Service<
  EmailConfig,
  { readonly values: Effect.Effect<ConfigValues, EmailDeliveryError> }
>()("astralbeam/email/EmailConfig") {
  static readonly layer = Layer.succeed(EmailConfig, {
    values: Effect.gen(function* () {
      const { getGlobalConfigState } = yield* Effect.promise(
        () => import("@/lib/config/runtime.server"),
      )
      const state = yield* Effect.tryPromise({
        try: () => getGlobalConfigState(),
        catch: () => new EmailDeliveryError({ reason: "configuration-unavailable" }),
      })
      return state.values
    }),
  })
}
