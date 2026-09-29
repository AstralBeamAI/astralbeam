import { Context, DateTime, Effect, Layer, Schema } from "effect"

import { APP_LOGO_LIGHT_PNG_URL } from "@/lib/constants"
import type { ConfigValues } from "@/lib/config/types"
import { EmailConfig } from "./config.server.ts"
import { EmailDeliveryError } from "./errors.ts"
import {
  type AccountExistsEmailData,
  accountExistsEmailMessage,
  type BetterAuthLinkEmailData,
  type EmailContext,
  type EmailKind,
  type EmailMessage,
  maskEmailAddressForLog,
  type OrganizationDeletedEmailData,
  organizationDeletedEmailMessage,
  type OrganizationInvitationEmailData,
  organizationInvitationEmailMessage,
  type PasswordChangedEmailData,
  passwordChangedEmailMessage,
  resetPasswordEmailMessage,
  verificationEmailMessage,
} from "./messages.server.ts"
import { EmailProviders } from "./providers/providers.server.ts"
import { renderEmailElement } from "./render.server.ts"
import {
  EMAIL_PROVIDER_SETTING_KEYS,
  type EmailProviderConnectionInput,
  EmailProviderConnectionInputSchema,
  type EmailProviderConnectionResult,
  EmailProviderSchema,
} from "./schemas.ts"

const decodeEmailProvider = Schema.decodeUnknownEffect(EmailProviderSchema)
const decodeEmailProviderSettings = Schema.decodeUnknownEffect(EmailProviderConnectionInputSchema)

/** The selected provider and its settings, with the SMTP-only default sender. */
const resolveEmailDelivery = Effect.fnUntraced(
  function* (values: ConfigValues) {
    const provider = yield* decodeEmailProvider(values.email_provider ?? "smtp")
    const settings = yield* decodeEmailProviderSettings({
      provider,
      settings: Object.fromEntries(
        EMAIL_PROVIDER_SETTING_KEYS[provider].map((key) => [key, values[key]]),
      ),
    })
    const from =
      values.email_from_address ||
      (provider === "smtp" && values.app_base_url
        ? `no-reply@${new URL(values.app_base_url).hostname}`
        : undefined)
    if (!values.app_base_url || !from)
      return yield* new EmailDeliveryError({ reason: "configuration" })
    const context = {
      appBaseUrl: values.app_base_url,
      logoURL: new URL(APP_LOGO_LIGHT_PNG_URL, values.app_base_url).href,
    }
    return { settings, from, context }
  },
  Effect.catchTag("SchemaError", () =>
    Effect.fail(new EmailDeliveryError({ reason: "configuration" })),
  ),
)

export class Mailer extends Context.Service<
  Mailer,
  {
    readonly sendVerification: (
      data: BetterAuthLinkEmailData,
    ) => Effect.Effect<void, EmailDeliveryError>
    readonly sendResetPassword: (
      data: BetterAuthLinkEmailData,
    ) => Effect.Effect<void, EmailDeliveryError>
    readonly sendPasswordChanged: (
      data: PasswordChangedEmailData,
    ) => Effect.Effect<void, EmailDeliveryError>
    readonly sendAccountExists: (
      data: AccountExistsEmailData,
    ) => Effect.Effect<void, EmailDeliveryError>
    readonly sendOrganizationInvitation: (
      data: OrganizationInvitationEmailData,
    ) => Effect.Effect<void, EmailDeliveryError>
    readonly sendOrganizationDeleted: (
      data: OrganizationDeletedEmailData,
    ) => Effect.Effect<void, EmailDeliveryError>
    /** Verifies submitted provider settings without sending, for the configuration page. */
    readonly testConnection: (
      input: EmailProviderConnectionInput,
    ) => Effect.Effect<EmailProviderConnectionResult>
  }
>()("astralbeam/email/Mailer") {
  static readonly layerNoDeps = Layer.effect(
    Mailer,
    Effect.gen(function* () {
      const config = yield* EmailConfig
      const providers = yield* EmailProviders

      /**
       * Every email funnels through here, the one place that logs a send outcome. Both outcomes
       * carry a partially masked recipient and a safe reason, never the rendered email or its links.
       */
      const deliver = Effect.fnUntraced(function* (
        kind: EmailKind,
        build: (context: EmailContext) => EmailMessage,
      ) {
        const delivery = yield* config.values.pipe(
          Effect.flatMap(resolveEmailDelivery),
          Effect.tapError((error) =>
            Effect.logError("Email preparation failed").pipe(
              Effect.annotateLogs({ kind, reason: error.reason }),
            ),
          ),
        )
        const now = DateTime.toDateUtc(yield* DateTime.now)
        const message = build({ ...delivery.context, now })
        const recipient = maskEmailAddressForLog(message.to)
        const { html, text } = yield* renderEmailElement(message.react)
        const messageId = yield* providers
          .send({
            settings: delivery.settings,
            email: { to: [message.to], from: delivery.from, subject: message.subject, html, text },
          })
          .pipe(
            Effect.tapError((error) =>
              Effect.logError("Email delivery failed").pipe(
                Effect.annotateLogs({
                  kind,
                  recipient,
                  provider: delivery.settings.provider,
                  reason: error.reason,
                }),
              ),
            ),
          )
        yield* Effect.logInfo("Email sent").pipe(
          Effect.annotateLogs({ kind, recipient, provider: delivery.settings.provider, messageId }),
        )
      })

      return Mailer.of({
        sendVerification: Effect.fn("Mailer.sendVerification")(function* (
          data: BetterAuthLinkEmailData,
        ) {
          yield* deliver("email-verification", (context) => verificationEmailMessage(data, context))
        }),
        sendResetPassword: Effect.fn("Mailer.sendResetPassword")(function* (
          data: BetterAuthLinkEmailData,
        ) {
          yield* deliver("reset-password", (context) => resetPasswordEmailMessage(data, context))
        }),
        sendPasswordChanged: Effect.fn("Mailer.sendPasswordChanged")(function* (
          data: PasswordChangedEmailData,
        ) {
          yield* deliver("password-changed", (context) =>
            passwordChangedEmailMessage(data, context),
          )
        }),
        sendAccountExists: Effect.fn("Mailer.sendAccountExists")(function* (
          data: AccountExistsEmailData,
        ) {
          yield* deliver("account-exists", (context) => accountExistsEmailMessage(data, context))
        }),
        sendOrganizationInvitation: Effect.fn("Mailer.sendOrganizationInvitation")(function* (
          data: OrganizationInvitationEmailData,
        ) {
          yield* deliver("organization-invitation", (context) =>
            organizationInvitationEmailMessage(data, context),
          )
        }),
        sendOrganizationDeleted: Effect.fn("Mailer.sendOrganizationDeleted")(function* (
          data: OrganizationDeletedEmailData,
        ) {
          yield* deliver("organization-deleted", (context) =>
            organizationDeletedEmailMessage(data, context),
          )
        }),
        testConnection: Effect.fn("Mailer.testConnection")(function* (
          input: EmailProviderConnectionInput,
        ) {
          return yield* providers.testConnection(input).pipe(
            Effect.as<EmailProviderConnectionResult>({ ok: true }),
            Effect.catchTag("EmailConnectionFailed", (error) =>
              Effect.succeed<EmailProviderConnectionResult>({
                ok: false,
                error: error.message || "Connection test failed",
              }),
            ),
          )
        }),
      })
    }),
  )

  static readonly layer = Mailer.layerNoDeps.pipe(
    Layer.provide([EmailConfig.layer, EmailProviders.layer]),
  )
}
