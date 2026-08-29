import { Effect, Schema } from "effect"

/** Providers `sendEmail` can dispatch to; each maps to one `src/emails/providers` module. */
export const EmailProviderSchema = Schema.Literals(["smtp", "resend", "ses"]).annotate({
  title: "Email provider",
  description: "Protocol used to deliver application email.",
  message: "Email provider must be 'smtp', 'resend', or 'ses'",
})
export type EmailProvider = Schema.Schema.Type<typeof EmailProviderSchema>

export const EMAIL_PROVIDER_SETTING_KEYS = {
  smtp: ["smtp_host", "smtp_port", "smtp_security", "smtp_username", "smtp_password"],
  resend: ["resend_api_key"],
  ses: ["aws_region", "aws_access_key_id", "aws_secret_access_key"],
} as const satisfies Record<EmailProvider, readonly string[]>

export const SMTP_DEFAULTS = {
  host: "127.0.0.1",
  port: 1025,
  security: "none",
} as const

export const SmtpSecuritySchema = Schema.Literals(["none", "auto", "starttls", "tls"])
  .annotate({
    title: "SMTP security",
    description: "TLS policy used for the SMTP connection.",
    message: "SMTP security must be 'none', 'auto', 'starttls', or 'tls'",
  })

export const SmtpPortSchema = Schema.Union([Schema.Number, Schema.NumberFromString]).pipe(
  Schema.check(
    Schema.isInt({ message: "SMTP port must be between 1 and 65535" }),
    Schema.isBetween({ minimum: 1, maximum: 65_535 }, {
      message: "SMTP port must be between 1 and 65535",
    }),
  ),
  Schema.optional,
  Schema.withDecodingDefault(Effect.succeed(SMTP_DEFAULTS.port)),
).annotate({
  title: "SMTP Port",
  description: "TCP port exposed by the SMTP server.",
})

export const SmtpProviderSettingsSchema = Schema.Struct({
  smtp_host: Schema.NonEmptyString.pipe(
    Schema.optional,
    Schema.withDecodingDefault(Effect.succeed(SMTP_DEFAULTS.host)),
  ).annotate({ message: "SMTP host must not be empty" }).annotateKey({
    title: "SMTP Host",
    description: "Hostname or IP address of the SMTP server.",
  }),
  smtp_port: SmtpPortSchema,
  smtp_security: SmtpSecuritySchema.pipe(
    Schema.optional,
    Schema.withDecodingDefault(Effect.succeed(SMTP_DEFAULTS.security)),
  ).annotateKey({
    title: "SMTP Security",
    description: "TLS policy used for the SMTP connection.",
  }),
  smtp_username: Schema.String.pipe(
    Schema.optional,
    Schema.withDecodingDefault(Effect.succeed("")),
  ).annotateKey({
    title: "SMTP Username",
    description: "Optional SMTP username; it must be paired with a password.",
  }),
  smtp_password: Schema.String.pipe(
    Schema.optional,
    Schema.withDecodingDefault(Effect.succeed("")),
  ).annotateKey({
    title: "SMTP Password",
    description: "Optional SMTP password; it must be paired with a username.",
  }),
}).pipe(
  Schema.check(
    Schema.makeFilter((settings) => {
      if (Boolean(settings.smtp_username) === Boolean(settings.smtp_password)) return
      const missing = settings.smtp_username ? "smtp_password" : "smtp_username"
      return {
        path: [missing],
        issue: "SMTP username and password must be configured together",
      }
    }),
  ),
).annotate({
  title: "SMTP connection settings",
  description: "Settings used to verify an SMTP server without sending email.",
  parseOptions: { errors: "all", onExcessProperty: "error", reportInput: false },
})
export type SmtpProviderSettings = Schema.Schema.Type<typeof SmtpProviderSettingsSchema>

const ResendProviderSettingsSchema = Schema.Struct({
  resend_api_key: Schema.NonEmptyString.annotate({
    message: "Resend API key must not be empty",
  }).annotateKey({
    title: "Resend API Key",
    description: "API key used to authenticate with Resend.",
    messageMissingKey: "Resend API key is required",
  }),
}).annotate({
  title: "Resend connection settings",
  description: "Settings used to verify access to the Resend API.",
  parseOptions: { errors: "all", onExcessProperty: "error", reportInput: false },
})
export type ResendProviderSettings = Schema.Schema.Type<typeof ResendProviderSettingsSchema>

const SesProviderSettingsSchema = Schema.Struct({
  aws_region: Schema.NonEmptyString.annotate({
    message: "AWS region must not be empty",
  }).annotateKey({
    title: "AWS Region",
    description: "AWS region containing the SES account.",
    messageMissingKey: "AWS region is required",
  }),
  aws_access_key_id: Schema.String.annotateKey({
    title: "AWS Access Key ID",
    description: "Optional static access key; it must be paired with a secret key.",
    messageMissingKey: "AWS access key ID is required",
  }),
  aws_secret_access_key: Schema.String.annotateKey({
    title: "AWS Secret Access Key",
    description: "Optional static secret key; it must be paired with an access key ID.",
    messageMissingKey: "AWS secret access key is required",
  }),
}).pipe(
  Schema.check(
    Schema.makeFilter((settings) => {
      if (Boolean(settings.aws_access_key_id) === Boolean(settings.aws_secret_access_key)) return
      const missing = settings.aws_access_key_id ? "aws_secret_access_key" : "aws_access_key_id"
      return {
        path: [missing],
        issue: "AWS access key ID and secret access key must be configured together",
      }
    }),
  ),
).annotate({
  title: "Amazon SES connection settings",
  description: "Settings used to verify access to Amazon SES.",
  parseOptions: { errors: "all", onExcessProperty: "error", reportInput: false },
})
export type SesProviderSettings = Schema.Schema.Type<typeof SesProviderSettingsSchema>

const EmailProviderConnectionResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.NonEmptyString }),
]).annotate({
  title: "Email provider connection result",
  description: "Result of verifying provider settings without sending email.",
})
type EmailProviderConnectionResult = Schema.Schema.Type<
  typeof EmailProviderConnectionResultSchema
>

export type TestConnection<Settings> = (
  settings: Settings,
) => Promise<EmailProviderConnectionResult>

export async function runConnectionTest(
  check: () => Promise<void>,
): Promise<EmailProviderConnectionResult> {
  try {
    await check()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Connection test failed" }
  }
}

export const EmailProviderConnectionInputSchema = Schema.Union([
  Schema.Struct({
    provider: Schema.Literal("smtp"),
    settings: SmtpProviderSettingsSchema,
  }),
  Schema.Struct({
    provider: Schema.Literal("resend"),
    settings: ResendProviderSettingsSchema,
  }),
  Schema.Struct({
    provider: Schema.Literal("ses"),
    settings: SesProviderSettingsSchema,
  }),
]).annotate({
  title: "Email provider connection test",
  description: "Provider-specific settings submitted from the configuration page for verification.",
  parseOptions: { errors: "all", onExcessProperty: "error", reportInput: false },
})
