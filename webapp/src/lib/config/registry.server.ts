import process from "node:process"

import { Schema } from "effect"

import { generateSecret } from "@/lib/generate-secret.server"
import type { ConfigDefinition, ConfigIssue, ConfigKey, ConfigValues } from "@/lib/types"

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
}

function isServerOrigin(url: URL): boolean {
  return (url.protocol === "https:" ||
    (url.protocol === "http:" && isLoopbackHost(url.hostname))) &&
    !url.username &&
    !url.password &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash
}

const decodeServerOrigin = Schema.decodeUnknownSync(
  Schema.URLFromString.pipe(
    Schema.check(Schema.makeFilter(isServerOrigin)),
  ),
)
const decodeSecretValue = Schema.decodeUnknownSync(
  Schema.String.pipe(Schema.check(Schema.isMinLength(32))),
)
const decodeNonEmptyText = Schema.decodeUnknownSync(Schema.NonEmptyString)
const decodeEmailProvider = Schema.decodeUnknownSync(Schema.Literals(["resend", "ses"]))
const decodePublicHttpUrl = Schema.decodeUnknownSync(
  Schema.URLFromString.pipe(
    Schema.check(
      Schema.makeFilter((url) => url.protocol === "https:" || url.protocol === "http:"),
    ),
  ),
)

function sanitizedDecoder(
  decodeValue: (value: unknown) => string,
  invalidMessage: string,
): (value: unknown) => string {
  return (value) => {
    try {
      return decodeValue(value)
    } catch (error) {
      if (!Schema.isSchemaError(error)) throw error
      // Never include the submitted or stored value in the error.
      throw new Error(invalidMessage)
    }
  }
}

const nonEmptyDecoder = (label: string) =>
  sanitizedDecoder(decodeNonEmptyText, `${label} must not be empty`)

export const CONFIG_DEFINITIONS: readonly ConfigDefinition[] = [
  {
    key: "app_base_url",
    group: "General",
    label: "Application Base URL",
    description:
      "Public origin the application is served from; used for authentication callbacks and links in emails.",
    kind: "url",
    required: true,
    isPublic: true,
    decode: sanitizedDecoder(
      (value) => decodeServerOrigin(value).origin,
      "Application base URL must be an HTTP(S) origin without credentials, path, query, or fragment, and must use HTTPS outside local development",
    ),
  },
  {
    key: "better_auth_secret",
    group: "Authentication",
    label: "Authentication Secret",
    description:
      "Signs authentication sessions and tokens. Rotating it signs every user out immediately.",
    kind: "secret",
    required: true,
    decode: sanitizedDecoder(
      decodeSecretValue,
      "Authentication secret must be at least 32 characters",
    ),
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
    decode: nonEmptyDecoder("Google client ID"),
  },
  {
    key: "google_client_secret",
    group: "Authentication",
    label: "Google Client Secret",
    description: "OAuth client secret paired with the Google client ID.",
    kind: "secret",
    required: false,
    decode: nonEmptyDecoder("Google client secret"),
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
    decode: nonEmptyDecoder("GitHub client ID"),
  },
  {
    key: "github_client_secret",
    group: "Authentication",
    label: "GitHub Client Secret",
    description: "OAuth client secret paired with the GitHub client ID.",
    kind: "secret",
    required: false,
    decode: nonEmptyDecoder("GitHub client secret"),
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
    decode: nonEmptyDecoder("Turnstile site key"),
  },
  {
    key: "turnstile_secret_key",
    group: "Authentication",
    label: "Turnstile Secret Key",
    description: "Server-only Cloudflare Turnstile secret paired with the site key.",
    kind: "secret",
    required: true,
    decode: nonEmptyDecoder("Turnstile secret key"),
  },
  {
    key: "email_provider",
    group: "Email Delivery",
    label: "Email Provider",
    description:
      "Delivery provider for authentication and notification emails. Leave unset to disable email delivery.",
    kind: "enum",
    required: false,
    options: [
      { value: "resend", label: "Resend" },
      { value: "ses", label: "Amazon SES" },
    ],
    decode: sanitizedDecoder(
      (value) => decodeEmailProvider(value),
      "Email provider must be 'resend' or 'ses'",
    ),
  },
  {
    key: "email_from_address",
    group: "Email Delivery",
    label: "Email From Address",
    description: "Default From address for outgoing email.",
    kind: "text",
    required: false,
    decode: nonEmptyDecoder("Email from address"),
  },
  {
    key: "resend_api_key",
    group: "Email Delivery",
    label: "Resend API Key",
    description: "Required when the email provider is Resend.",
    kind: "secret",
    required: false,
    decode: nonEmptyDecoder("Resend API key"),
  },
  {
    key: "aws_region",
    group: "Email Delivery",
    label: "AWS Region",
    description: "Required when the email provider is SES.",
    kind: "text",
    required: false,
    decode: nonEmptyDecoder("AWS region"),
  },
  {
    key: "aws_access_key_id",
    group: "Email Delivery",
    label: "AWS Access Key ID",
    description:
      "Used to send email through SES. Leave both AWS credential fields unset to use the deployment's own AWS credential chain, such as an IAM role or profile.",
    kind: "text",
    required: false,
    decode: nonEmptyDecoder("AWS access key ID"),
  },
  {
    key: "aws_secret_access_key",
    group: "Email Delivery",
    label: "AWS Secret Access Key",
    description: "Paired with the AWS access key ID.",
    kind: "secret",
    required: false,
    decode: nonEmptyDecoder("AWS secret access key"),
  },
  {
    key: "openai_api_key",
    group: "LLM Providers",
    label: "OpenAI API Key",
    description: "Powers the chat API. Chat requests fail with 503 while it is unset.",
    kind: "secret",
    required: false,
    decode: nonEmptyDecoder("OpenAI API key"),
  },
  {
    key: "chat_auth_secret",
    group: "General",
    label: "Chat Authentication Secret",
    description: "Verifies signed-in SDK chat requests. Chat is unavailable while it is unset.",
    kind: "secret",
    required: false,
    decode: sanitizedDecoder(
      decodeSecretValue,
      "Chat authentication secret must be at least 32 characters",
    ),
    generate: generateSecret,
  },
  {
    key: "privacy_policy_url",
    group: "General",
    label: "Privacy Policy URL",
    description: "Public link shown during sign-up.",
    kind: "url",
    required: false,
    isPublic: true,
    decode: sanitizedDecoder(
      (value) => decodePublicHttpUrl(value).href,
      "Privacy policy URL must use HTTP(S)",
    ),
  },
  {
    key: "terms_of_service_url",
    group: "General",
    label: "Terms of Service URL",
    description: "Public link shown during sign-up.",
    kind: "url",
    required: false,
    isPublic: true,
    decode: sanitizedDecoder(
      (value) => decodePublicHttpUrl(value).href,
      "Terms of service URL must use HTTP(S)",
    ),
  },
]

const definitionByKey = new Map<string, ConfigDefinition>(
  CONFIG_DEFINITIONS.map((definition) => [definition.key, definition]),
)

export function configEnvironmentVariable(key: ConfigKey): Uppercase<ConfigKey> {
  return key.toUpperCase() as Uppercase<ConfigKey>
}

export function hasEnvironmentConfigOverride(key: ConfigKey): boolean {
  const value = process.env[configEnvironmentVariable(key)]
  return value !== undefined && value !== ""
}

export function environmentConfigOverrideKeys(): ConfigKey[] {
  return CONFIG_DEFINITIONS
    .filter((definition) => hasEnvironmentConfigOverride(definition.key))
    .map((definition) => definition.key)
}

function parseEnvironmentConfigValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function findConfigDefinition(key: string): ConfigDefinition | undefined {
  return definitionByKey.get(key)
}

// Environment values may use JSON syntax so they behave like equivalent JSONB values; ordinary
// unquoted strings remain valid for shell ergonomics.
export function environmentConfigValues(): ConfigValues {
  const values: ConfigValues = {}
  for (const definition of CONFIG_DEFINITIONS) {
    const environmentVariable = configEnvironmentVariable(definition.key)
    const environmentValue = process.env[environmentVariable]
    if (environmentValue === undefined || environmentValue === "") continue
    try {
      values[definition.key] = definition.decode(parseEnvironmentConfigValue(environmentValue))
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid value"
      throw new Error(`${environmentVariable}: ${message}`)
    }
  }
  return values
}

export function validateConfigCompleteness(values: ConfigValues): ConfigIssue[] {
  const issues: ConfigIssue[] = []
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
  if (values.email_provider && !values.email_from_address) {
    issues.push({
      key: "email_from_address",
      message: "An email from address is required when an email provider is selected",
    })
  }
  if (values.email_provider === "resend" && !values.resend_api_key) {
    issues.push({
      key: "resend_api_key",
      message: "Resend is the selected email provider but no Resend API key is configured",
    })
  }
  const hasAwsAccessKeyEnvironmentOverride = hasEnvironmentConfigOverride("aws_access_key_id")
  const hasAwsSecretKeyEnvironmentOverride = hasEnvironmentConfigOverride("aws_secret_access_key")
  if (hasAwsAccessKeyEnvironmentOverride !== hasAwsSecretKeyEnvironmentOverride) {
    const missing = hasAwsAccessKeyEnvironmentOverride
      ? "aws_secret_access_key"
      : "aws_access_key_id"
    issues.push({
      key: missing,
      message: `${
        configEnvironmentVariable(missing)
      } is required when the paired AWS credential is supplied through the environment`,
    })
  } else if (Boolean(values.aws_access_key_id) !== Boolean(values.aws_secret_access_key)) {
    const missing = values.aws_access_key_id ? "aws_secret_access_key" : "aws_access_key_id"
    issues.push({
      key: missing as ConfigKey,
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
