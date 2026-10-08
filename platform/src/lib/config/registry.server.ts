import { Result, Schema, SchemaGetter } from "effect"

import {
  EmailProviderSchema,
  SMTP_DEFAULTS,
  SmtpPortSchema,
  SmtpSecuritySchema,
} from "@/lib/email/schemas"
import { ApiKeyCredentialSchema, parseApiKeyCredential } from "@/lib/api-keys/schemas"
import { generateSecret } from "@/lib/utils.server"
import { StorageEndpointSchema, StoredStorageDestinationSchema } from "@/lib/storage/schemas"
import {
  EmailAddressSchema,
  enumSchema,
  NonEmptyStringSchema,
  strictParseOptions,
  UuidV7Schema,
} from "@/lib/schemas"
import type { ConfigDefinition, ConfigIssue, ConfigKey, ConfigValues } from "./types.ts"

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
}

function isServerOrigin(url: URL): boolean {
  return (
    (url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname))) &&
    !url.username &&
    !url.password &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash
  )
}

const ServerOriginSchema = Schema.URLFromString.check(
  Schema.makeFilter(isServerOrigin, {
    message:
      "Use an HTTP(S) origin without credentials, path, query, or fragment, and HTTPS outside local development",
  }),
).pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((url) => url.origin),
    encode: SchemaGetter.transform((value) => new URL(value)),
  }),
)

// Resend and SES accept a bare address or a display name followed by an address.
// https://resend.com/docs/api-reference/emails/send-email
const NAMED_EMAIL_ADDRESS_PATTERN = /^(?:[^<>@,]*\S\s*)?<([^\s<>,]+)>$/
const isEmailAddress = Schema.is(EmailAddressSchema)
const EmailFromAddressSchema = Schema.String.check(
  Schema.makeFilter(
    (value) => isEmailAddress(NAMED_EMAIL_ADDRESS_PATTERN.exec(value)?.[1] ?? value),
    { message: "Email from address must be 'email@example.com' or 'Name <email@example.com>'" },
  ),
)
const PublicHttpUrlSchema = Schema.URLFromString.check(
  Schema.makeFilter((url) => url.protocol === "https:" || url.protocol === "http:", {
    message: "URL must use HTTP(S)",
  }),
).pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((url) => url.href),
    encode: SchemaGetter.transform((value) => new URL(value)),
  }),
)

// Environment values parse as JSON, so ALLOW_PRIVATE_MODEL_ENDPOINTS=true arrives as a boolean.
const BooleanSettingLiteralSchema = enumSchema(["false", "true"])
const BooleanSettingSchema = Schema.Union([
  BooleanSettingLiteralSchema,
  Schema.Boolean.pipe(
    Schema.decodeTo(BooleanSettingLiteralSchema, {
      decode: SchemaGetter.transform((value) => (value ? "true" : "false")),
      encode: SchemaGetter.transform((value) => value === "true"),
    }),
  ),
])

/** Fails with a generated message that never repeats the rejected value. */
export function decodeConfigValue(
  definition: ConfigDefinition,
  value: unknown,
): Result.Result<string, Schema.SchemaError> {
  return Schema.decodeUnknownResult(definition.schema, strictParseOptions)(value)
}

export const CONFIG_DEFINITIONS: readonly ConfigDefinition[] = [
  {
    key: "s3_destination",
    group: "File storage",
    label: "Storage destination",
    description: "Pinned when application objects are first prepared.",
    kind: "text",
    required: false,
    systemManaged: true,
    schema: Schema.String.check(
      Schema.makeFilter((value) =>
        Result.isSuccess(Schema.decodeUnknownResult(StoredStorageDestinationSchema)(value)),
      ),
    ),
  },
  {
    key: "s3_endpoint",
    group: "File storage",
    label: "S3 endpoint",
    description: "Storage API origin. Use HTTPS in production and a private bucket.",
    kind: "url",
    required: true,
    schema: StorageEndpointSchema,
  },
  {
    key: "s3_region",
    group: "File storage",
    label: "S3 region",
    description: "Bucket region, or auto for Cloudflare R2.",
    kind: "text",
    required: true,
    schema: NonEmptyStringSchema,
  },
  {
    key: "s3_bucket",
    group: "File storage",
    label: "S3 bucket",
    description: "Private bucket dedicated to this deployment.",
    kind: "text",
    required: true,
    schema: NonEmptyStringSchema,
  },
  {
    key: "s3_access_key_id",
    group: "File storage",
    label: "S3 access-key ID",
    description: "Storage credential with object read, write, and delete permissions.",
    kind: "secret",
    required: true,
    schema: NonEmptyStringSchema,
  },
  {
    key: "s3_secret_access_key",
    group: "File storage",
    label: "S3 secret access key",
    description: "Secret belonging to the S3 access-key ID.",
    kind: "secret",
    required: true,
    schema: NonEmptyStringSchema,
  },
  {
    key: "s3_path_style",
    group: "File storage",
    label: "S3 addressing",
    description: "Use path-style addressing for backends such as MinIO.",
    kind: "enum",
    required: true,
    defaultValue: "false",
    options: [
      { value: "false", label: "Virtual host" },
      { value: "true", label: "Path style" },
    ],
    schema: BooleanSettingSchema,
  },
  {
    key: "dogfood_organization_id",
    group: "General",
    label: "Owner onboarding",
    description: "Organization hosting the embedded assistant.",
    kind: "secret",
    required: true,
    systemManaged: true,
    schema: UuidV7Schema,
  },
  {
    key: "dogfood_api_key",
    group: "General",
    label: "Embedded assistant credential",
    description: "Server-only credential provisioned during owner onboarding.",
    kind: "secret",
    required: true,
    systemManaged: true,
    schema: ApiKeyCredentialSchema,
  },
  {
    key: "dogfood_pending_setup",
    group: "General",
    label: "Pending owner onboarding",
    description: "Encrypted recovery state for incomplete owner onboarding.",
    kind: "secret",
    required: false,
    systemManaged: true,
    schema: NonEmptyStringSchema,
  },
  {
    key: "app_base_url",
    group: "General",
    label: "Application Base URL",
    description:
      "Public origin the application is served from; used for authentication callbacks and links in emails.",
    kind: "url",
    required: true,
    isPublic: true,
    schema: ServerOriginSchema,
  },
  {
    key: "better_auth_secret",
    group: "Authentication",
    label: "Authentication Secret",
    description:
      "Signs authentication sessions and tokens. Rotating it signs every user out immediately.",
    kind: "secret",
    required: true,
    schema: Schema.String.check(Schema.isMinLength(32)),
    generate: generateSecret,
  },
  {
    key: "google_client_id",
    group: "Authentication",
    label: "Google Client ID",
    description:
      "OAuth client ID from the Google Cloud console. Set both Google fields to enable Google sign-in.",
    kind: "text",
    required: false,
    isPublic: true,
    schema: NonEmptyStringSchema,
  },
  {
    key: "google_client_secret",
    group: "Authentication",
    label: "Google Client Secret",
    description: "OAuth client secret paired with the Google client ID.",
    kind: "secret",
    required: false,
    schema: NonEmptyStringSchema,
  },
  {
    key: "github_client_id",
    group: "Authentication",
    label: "GitHub Client ID",
    description:
      "OAuth client ID from the GitHub developer settings. Set both GitHub fields to enable GitHub sign-in.",
    kind: "text",
    required: false,
    isPublic: true,
    schema: NonEmptyStringSchema,
  },
  {
    key: "github_client_secret",
    group: "Authentication",
    label: "GitHub Client Secret",
    description: "OAuth client secret paired with the GitHub client ID.",
    kind: "secret",
    required: false,
    schema: NonEmptyStringSchema,
  },
  {
    key: "turnstile_site_key",
    group: "Authentication",
    label: "Turnstile Site Key",
    description:
      "Public Cloudflare Turnstile site key used to protect sign-in, sign-up, and password-reset requests.",
    kind: "text",
    required: true,
    isPublic: true,
    schema: NonEmptyStringSchema,
  },
  {
    key: "turnstile_secret_key",
    group: "Authentication",
    label: "Turnstile Secret Key",
    description: "Server-only Cloudflare Turnstile secret paired with the site key.",
    kind: "secret",
    required: true,
    schema: NonEmptyStringSchema,
  },
  {
    key: "email_provider",
    group: "Email Delivery",
    label: "Email Provider",
    description: "Delivery protocol for authentication and notification emails. Defaults to SMTP.",
    kind: "enum",
    required: false,
    defaultValue: "smtp",
    options: [
      { value: "smtp", label: "SMTP — Local, self-hosted, or hosted SMTP server" },
      { value: "resend", label: "Resend API" },
      { value: "ses", label: "Amazon SES API" },
    ],
    schema: EmailProviderSchema,
  },
  {
    key: "email_from_address",
    group: "Email Delivery",
    label: "Email From Address",
    description:
      "Default From address for outgoing email, as 'email@example.com' or 'Name <email@example.com>'.",
    kind: "text",
    required: false,
    schema: EmailFromAddressSchema,
  },
  {
    key: "smtp_host",
    group: "Email Delivery",
    label: "SMTP Host",
    description: "Mail server hostname. Defaults to 127.0.0.1.",
    kind: "text",
    required: false,
    defaultValue: SMTP_DEFAULTS.host,
    schema: NonEmptyStringSchema,
  },
  {
    key: "smtp_port",
    group: "Email Delivery",
    label: "SMTP Port",
    description: "Mail server port. Defaults to 1025.",
    kind: "text",
    required: false,
    defaultValue: String(SMTP_DEFAULTS.port),
    schema: SmtpPortSchema.pipe(Schema.decodeTo(Schema.flip(Schema.NumberFromString))),
  },
  {
    key: "smtp_security",
    group: "Email Delivery",
    label: "SMTP Security",
    description:
      "Defaults to an unencrypted local connection. Hosted servers normally require STARTTLS or TLS.",
    kind: "enum",
    required: false,
    defaultValue: SMTP_DEFAULTS.security,
    options: [
      { value: "none", label: "None — Local or trusted relay" },
      {
        value: "auto",
        label: "STARTTLS when available — May remain unencrypted",
      },
      { value: "starttls", label: "Require STARTTLS — Usually port 587" },
      { value: "tls", label: "TLS from connection start — Usually port 465" },
    ],
    schema: SmtpSecuritySchema,
  },
  {
    key: "smtp_username",
    group: "Email Delivery",
    label: "SMTP Username",
    description:
      "Optional username. Set it together with an SMTP password to enable authentication.",
    kind: "text",
    required: false,
    schema: NonEmptyStringSchema,
  },
  {
    key: "smtp_password",
    group: "Email Delivery",
    label: "SMTP Password",
    description: "Optional password paired with the SMTP username.",
    kind: "secret",
    required: false,
    schema: NonEmptyStringSchema,
  },
  {
    key: "resend_api_key",
    group: "Email Delivery",
    label: "Resend API Key",
    description: "Required when the email provider is Resend.",
    kind: "secret",
    required: false,
    schema: NonEmptyStringSchema,
  },
  {
    key: "aws_region",
    group: "Email Delivery",
    label: "AWS Region",
    description: "Required when the email provider is SES.",
    kind: "text",
    required: false,
    schema: NonEmptyStringSchema,
  },
  {
    key: "aws_access_key_id",
    group: "Email Delivery",
    label: "AWS Access Key ID",
    description:
      "Used to send email through SES. Leave both AWS credential fields unset to use the deployment's own AWS credential chain, such as an IAM role or profile.",
    kind: "text",
    required: false,
    schema: NonEmptyStringSchema,
  },
  {
    key: "aws_secret_access_key",
    group: "Email Delivery",
    label: "AWS Secret Access Key",
    description: "Paired with the AWS access key ID.",
    kind: "secret",
    required: false,
    schema: NonEmptyStringSchema,
  },
  {
    key: "privacy_policy_url",
    group: "General",
    label: "Privacy Policy URL",
    description: "Public link shown during sign-up.",
    kind: "url",
    required: false,
    isPublic: true,
    schema: PublicHttpUrlSchema,
  },
  {
    key: "terms_of_service_url",
    group: "General",
    label: "Terms of Service URL",
    description: "Public link shown during sign-up.",
    kind: "url",
    required: false,
    isPublic: true,
    schema: PublicHttpUrlSchema,
  },
  {
    key: "support_email_address",
    group: "General",
    label: "Support Email Address",
    description:
      "Copied on welcome and support request emails so replies reach your team, and where Contact Support requests go.",
    kind: "text",
    required: true,
    isPublic: true,
    schema: EmailAddressSchema,
  },
  {
    key: "website_url",
    group: "General",
    label: "Website URL",
    description:
      "Origin of a separately hosted website served under this application's origin. Signed-out visitors to / and everyone at /home see its home page.",
    kind: "url",
    required: false,
    schema: ServerOriginSchema,
  },
  {
    key: "allow_private_model_endpoints",
    group: "General",
    label: "Allow Private Model Endpoints",
    description:
      "Lets organizations use HTTP model provider URLs and loopback, private, or link-local hosts, such as a LAN gateway. Keep it off when untrusted organizations share this deployment.",
    kind: "enum",
    required: false,
    defaultValue: "false",
    options: [
      { value: "false", label: "Off (public HTTPS endpoints only)" },
      { value: "true", label: "On (also allow HTTP and private networks)" },
    ],
    schema: BooleanSettingSchema,
  },
]

const definitionByKey = new Map<string, ConfigDefinition>(
  CONFIG_DEFINITIONS.map((definition) => [definition.key, definition]),
)

export function configEnvironmentVariable(key: ConfigKey): Uppercase<ConfigKey> {
  return key.toUpperCase() as Uppercase<ConfigKey>
}

export function findConfigDefinition(key: string): ConfigDefinition | undefined {
  return definitionByKey.get(key)
}

export const DEFAULT_CONFIG_VALUES = Object.fromEntries(
  CONFIG_DEFINITIONS.flatMap((definition) =>
    definition.defaultValue === undefined ? [] : [[definition.key, definition.defaultValue]],
  ),
) as ConfigValues

/** System-managed values stay database-only, so no environment variable can replace them. */
export const ENVIRONMENT_CONFIG_DEFINITIONS = CONFIG_DEFINITIONS.filter(
  (definition) => !definition.systemManaged,
)

// Environment values may use JSON syntax so they behave like equivalent JSONB values; ordinary
// unquoted strings remain valid for shell ergonomics.
export function parseEnvironmentConfigValue(value: string): unknown {
  return Result.getOrElse(
    Result.try(() => JSON.parse(value) as unknown),
    () => value,
  )
}

/** `environmentKeys` names the keys an environment variable supplies. */
export function validateConfigCompleteness(
  values: ConfigValues,
  environmentKeys: ReadonlySet<ConfigKey> = new Set(),
): ConfigIssue[] {
  const issues: ConfigIssue[] = []
  if (
    values.dogfood_api_key &&
    values.dogfood_organization_id &&
    parseApiKeyCredential(values.dogfood_api_key)?.organizationId !== values.dogfood_organization_id
  ) {
    issues.push({
      key: "dogfood_api_key",
      message: "Embedded assistant credential ownership is invalid",
    })
  }
  for (const definition of CONFIG_DEFINITIONS) {
    if (definition.required && !values[definition.key]) {
      issues.push({ key: definition.key, message: `${definition.label} is required` })
    }
  }
  for (const provider of ["google", "github"] as const) {
    const id = values[`${provider}_client_id`]
    const secret = values[`${provider}_client_secret`]
    if (Boolean(id) !== Boolean(secret)) {
      const missing = id ? `${provider}_client_secret` : `${provider}_client_id`
      issues.push({
        key: missing as ConfigKey,
        message: `${
          findConfigDefinition(missing)?.label
        } is required to enable this sign-in provider`,
      })
    }
  }
  if (values.email_provider && values.email_provider !== "smtp" && !values.email_from_address) {
    issues.push({
      key: "email_from_address",
      // A malformed value decodes to nothing, so this also reports a rejected From address shape.
      message: "A valid email from address is required when an email provider is selected",
    })
  }
  if (values.email_provider === "resend" && !values.resend_api_key) {
    issues.push({
      key: "resend_api_key",
      message: "Resend is the selected email provider but no Resend API key is configured",
    })
  }
  if (
    values.email_provider === "smtp" &&
    Boolean(values.smtp_username) !== Boolean(values.smtp_password)
  ) {
    const missing = values.smtp_username ? "smtp_password" : "smtp_username"
    issues.push({
      key: missing,
      message: `${findConfigDefinition(missing)?.label} is required when its pair is configured`,
    })
  }
  const hasAwsAccessKeyEnvironmentOverride = environmentKeys.has("aws_access_key_id")
  const hasAwsSecretKeyEnvironmentOverride = environmentKeys.has("aws_secret_access_key")
  if (hasAwsAccessKeyEnvironmentOverride !== hasAwsSecretKeyEnvironmentOverride) {
    const missing = hasAwsAccessKeyEnvironmentOverride
      ? "aws_secret_access_key"
      : "aws_access_key_id"
    issues.push({
      key: missing,
      message: `${configEnvironmentVariable(
        missing,
      )} is required when the paired AWS credential is supplied through the environment`,
    })
  } else if (Boolean(values.aws_access_key_id) !== Boolean(values.aws_secret_access_key)) {
    const missing = values.aws_access_key_id ? "aws_secret_access_key" : "aws_access_key_id"
    issues.push({
      key: missing,
      message: `${findConfigDefinition(missing)?.label} is required to use static AWS credentials`,
    })
  }
  if (values.email_provider === "ses" && !values.aws_region) {
    issues.push({
      key: "aws_region",
      message: "SES is the selected email provider but no AWS region is configured",
    })
  }
  return issues
}
