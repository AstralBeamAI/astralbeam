import { Config, Context, Effect, Equal, Layer, RcMap, type Scope } from "effect"

import { errorReason } from "@/lib/runtime/failure-report.server"
import { EmailConnectionFailed, EmailDeliveryError } from "../errors.ts"
import type { EmailProvider, EmailProviderConnectionInput } from "../schemas.ts"

/** The rendered message every provider sends. */
export interface ProviderEmail {
  readonly to: readonly string[]
  readonly from: string
  readonly subject: string
  readonly html: string
  readonly text: string
}

/** Sends one message, succeeding with the provider's message ID when it returns one. */
type ProviderEmailSend = (
  email: ProviderEmail,
) => Effect.Effect<string | undefined, EmailDeliveryError>

/** The contract every `providers/*.server.ts` module implements under the same export names. */
interface EmailProviderModule<Settings> {
  /** Builds one client for the settings, closed with the scope. */
  readonly acquireSender: (
    settings: Settings,
  ) => Effect.Effect<ProviderEmailSend, never, Scope.Scope>
  /** Verifies the settings without sending email. */
  readonly testConnection: (settings: Settings) => Effect.Effect<void, EmailConnectionFailed>
}

type EmailProviderSettings<Provider extends EmailProvider> = Extract<
  EmailProviderConnectionInput,
  { provider: Provider }
>["settings"]

// A static map of dynamic imports loads only the selected provider's SDK, while the literal
// specifiers stay analyzable for bundling and unused-file detection.
const EMAIL_PROVIDER_MODULES: {
  readonly [Provider in EmailProvider]: () => Promise<
    EmailProviderModule<EmailProviderSettings<Provider>>
  >
} = {
  smtp: () => import("./smtp.server.ts"),
  resend: () => import("./resend.server.ts"),
  ses: () => import("./ses.server.ts"),
}

const EMAIL_PROVIDER_TIMEOUT = "30 seconds"
const EMAIL_SENDER_IDLE_TIME_TO_LIVE = "10 minutes"

// The input's provider selects the module, so its settings always match that module.
function loadEmailProvider(provider: EmailProvider) {
  return Effect.promise(
    () =>
      EMAIL_PROVIDER_MODULES[provider]() as Promise<
        EmailProviderModule<EmailProviderConnectionInput["settings"]>
      >,
  )
}

/** Wraps one provider call with the shared timeout and a loggable failure. */
export function emailProviderCall<A>(call: (signal: AbortSignal) => PromiseLike<A>) {
  return Effect.tryPromise({
    try: call,
    catch: (cause) => new EmailDeliveryError({ reason: errorReason(cause) }),
  }).pipe(
    Effect.timeout(EMAIL_PROVIDER_TIMEOUT),
    Effect.catchTag("TimeoutError", () =>
      Effect.fail(new EmailDeliveryError({ reason: "timeout" })),
    ),
  )
}

/** Wraps one connection check, keeping the provider's message for the operator who ran it. */
export function emailConnectionCheck<A>(check: (signal: AbortSignal) => PromiseLike<A>) {
  return Effect.tryPromise({
    try: check,
    catch: (cause) =>
      new EmailConnectionFailed({
        message: cause instanceof Error && cause.message ? cause.message : "Connection test failed",
      }),
  }).pipe(
    Effect.timeout(EMAIL_PROVIDER_TIMEOUT),
    Effect.catchTag("TimeoutError", () =>
      Effect.fail(new EmailConnectionFailed({ message: "The provider did not respond in time" })),
    ),
  )
}

// Vitest sets VITEST, and a test run must never reach a real provider.
const EmailTestRunConfig = Config.all({
  vitest: Config.String("VITEST").pipe(Config.withDefault("")),
  nodeEnv: Config.String("NODE_ENV").pipe(Config.withDefault("")),
}).pipe(Config.map(({ vitest, nodeEnv }) => vitest === "true" || nodeEnv === "test"))

export class EmailProviders extends Context.Service<
  EmailProviders,
  {
    readonly send: (input: {
      readonly settings: EmailProviderConnectionInput
      readonly email: ProviderEmail
    }) => Effect.Effect<string | undefined, EmailDeliveryError>
    readonly testConnection: (
      settings: EmailProviderConnectionInput,
    ) => Effect.Effect<void, EmailConnectionFailed>
  }
>()("astralbeam/email/EmailProviders") {
  static readonly layer = Layer.effect(
    EmailProviders,
    Effect.gen(function* () {
      const testRun = yield* EmailTestRunConfig.pipe(Effect.orDie)
      // One client per configuration, reused across sends and released once another replaces it.
      const senders = yield* RcMap.make({
        lookup: (settings: EmailProviderConnectionInput) =>
          Effect.flatMap(loadEmailProvider(settings.provider), (module) =>
            module.acquireSender(settings.settings),
          ),
        idleTimeToLive: EMAIL_SENDER_IDLE_TIME_TO_LIVE,
      })

      const send = Effect.fn("EmailProviders.send")(function* (input: {
        settings: EmailProviderConnectionInput
        email: ProviderEmail
      }) {
        if (testRun) return yield* new EmailDeliveryError({ reason: "disabled-in-tests" })
        for (const key of yield* RcMap.keys(senders)) {
          if (!Equal.equals(key, input.settings)) yield* RcMap.invalidate(senders, key)
        }
        const sendEmail = yield* RcMap.get(senders, input.settings)
        return yield* sendEmail(input.email)
      }, Effect.scoped)

      const testConnection = Effect.fn("EmailProviders.testConnection")(function* (
        settings: EmailProviderConnectionInput,
      ) {
        const module = yield* loadEmailProvider(settings.provider)
        return yield* module.testConnection(settings.settings)
      })

      return EmailProviders.of({ send, testConnection })
    }),
  )
}
