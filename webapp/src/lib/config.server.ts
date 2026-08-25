import { randomBytes } from "node:crypto"
import process from "node:process"

import { Schema } from "effect"

import {
  DEFAULT_PRIVACY_POLICY_URL,
  DEFAULT_TERMS_OF_SERVICE_URL,
  type PublicConfig,
} from "@/lib/config"

const decodeRequiredEnvironmentValue = Schema.decodeUnknownSync(Schema.NonEmptyString)

function ensureServerEnv(key: string): string {
  try {
    return decodeRequiredEnvironmentValue(process.env[key])
  } catch (error) {
    if (!Schema.isSchemaError(error)) throw error
    throw new Error(`'${key}' environment variable is not set`)
  }
}

// The only environment variable; every other runtime setting lives in the `config` table and is
// managed through the /configure operator page.
export const DATABASE_URL = ensureServerEnv("DATABASE_URL")

function isServerOrigin(url: URL): boolean {
  return (url.protocol === "https:" ||
    (url.protocol === "http:" && isLoopbackHost(url.hostname))) &&
    !url.username &&
    !url.password &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
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

function generateSecret(): string {
  return randomBytes(32).toString("base64url")
}

type ConfigKey =
  | "app_base_url"
  | "better_auth_secret"
  | "google_client_id"
  | "google_client_secret"
  | "github_client_id"
  | "github_client_secret"
  | "email_provider"
  | "email_from_address"
  | "resend_api_key"
  | "aws_region"
  | "aws_access_key_id"
  | "aws_secret_access_key"
  | "openai_api_key"
  | "chat_auth_secret"
  | "privacy_policy_url"
  | "terms_of_service_url"

// Marker row written by /configure when setup finishes; deliberately not a registry key so the
// editor never lists it and saves never touch it directly.
export const SETUP_COMPLETED_KEY = "setup_completed"

interface ConfigDefinition {
  key: ConfigKey
  label: string
  description: string
  kind: "text" | "url" | "secret" | "enum"
  required: boolean
  secret: boolean
  /** The stored value is visible to end users (public pages or browser-visible URLs). */
  isPublic?: true
  options?: readonly string[]
  decode: (value: unknown) => string
  generate?: () => string
}

const nonEmptyDecoder = (label: string) =>
  sanitizedDecoder(decodeNonEmptyText, `${label} must not be empty`)

export const CONFIG_DEFINITIONS: readonly ConfigDefinition[] = [
  {
    key: "app_base_url",
    label: "Application Base URL",
    description:
      "Public origin the application is served from; used for authentication callbacks and links in emails.",
    kind: "url",
    required: true,
    secret: false,
    isPublic: true,
    decode: sanitizedDecoder(
      (value) => decodeServerOrigin(value).origin,
      "Application base URL must be an HTTP(S) origin without credentials, path, query, or fragment, and must use HTTPS outside local development",
    ),
  },
  {
    key: "better_auth_secret",
    label: "Authentication Secret",
    description:
      "Signs authentication sessions and tokens. Rotating it signs every user out immediately.",
    kind: "secret",
    required: true,
    secret: true,
    decode: sanitizedDecoder(
      decodeSecretValue,
      "Authentication secret must be at least 32 characters",
    ),
    generate: generateSecret,
  },
  {
    key: "google_client_id",
    label: "Google Client ID",
    description:
      "OAuth client ID from the Google Cloud console. Set both Google fields to enable Google sign-in.",
    kind: "text",
    required: false,
    secret: false,
    isPublic: true,
    decode: nonEmptyDecoder("Google client ID"),
  },
  {
    key: "google_client_secret",
    label: "Google Client Secret",
    description: "OAuth client secret paired with the Google client ID.",
    kind: "secret",
    required: false,
    secret: true,
    decode: nonEmptyDecoder("Google client secret"),
  },
  {
    key: "github_client_id",
    label: "GitHub Client ID",
    description:
      "OAuth client ID from the GitHub developer settings. Set both GitHub fields to enable GitHub sign-in.",
    kind: "text",
    required: false,
    secret: false,
    isPublic: true,
    decode: nonEmptyDecoder("GitHub client ID"),
  },
  {
    key: "github_client_secret",
    label: "GitHub Client Secret",
    description: "OAuth client secret paired with the GitHub client ID.",
    kind: "secret",
    required: false,
    secret: true,
    decode: nonEmptyDecoder("GitHub client secret"),
  },
  {
    key: "email_provider",
    label: "Email Provider",
    description:
      "Delivery provider for authentication and notification emails. Leave unset to disable email delivery.",
    kind: "enum",
    required: false,
    secret: false,
    options: ["resend", "ses"],
    decode: sanitizedDecoder(
      (value) => decodeEmailProvider(value),
      "Email provider must be 'resend' or 'ses'",
    ),
  },
  {
    key: "email_from_address",
    label: "Email From Address",
    description: "Default From address for outgoing email.",
    kind: "text",
    required: false,
    secret: false,
    decode: nonEmptyDecoder("Email from address"),
  },
  {
    key: "resend_api_key",
    label: "Resend API Key",
    description: "Required when the email provider is Resend.",
    kind: "secret",
    required: false,
    secret: true,
    decode: nonEmptyDecoder("Resend API key"),
  },
  {
    key: "aws_region",
    label: "AWS Region",
    description: "Required when the email provider is SES.",
    kind: "text",
    required: false,
    secret: false,
    decode: nonEmptyDecoder("AWS region"),
  },
  {
    key: "aws_access_key_id",
    label: "AWS Access Key ID",
    description:
      "Used to send email through SES. Leave both AWS credential fields unset to use the deployment's own AWS credential chain, such as an IAM role or profile.",
    kind: "text",
    required: false,
    secret: false,
    decode: nonEmptyDecoder("AWS access key ID"),
  },
  {
    key: "aws_secret_access_key",
    label: "AWS Secret Access Key",
    description: "Paired with the AWS access key ID.",
    kind: "secret",
    required: false,
    secret: true,
    decode: nonEmptyDecoder("AWS secret access key"),
  },
  {
    key: "openai_api_key",
    label: "OpenAI API Key",
    description: "Powers the chat API. Chat requests fail with 503 while it is unset.",
    kind: "secret",
    required: false,
    secret: true,
    decode: nonEmptyDecoder("OpenAI API key"),
  },
  {
    key: "chat_auth_secret",
    label: "Chat Authentication Secret",
    description:
      "Verifies authenticated SDK chat requests. Guest chat works without it; authenticated requests fail closed while it is unset.",
    kind: "secret",
    required: false,
    secret: true,
    decode: sanitizedDecoder(
      decodeSecretValue,
      "Chat authentication secret must be at least 32 characters",
    ),
    generate: generateSecret,
  },
  {
    key: "privacy_policy_url",
    label: "Privacy Policy URL",
    description: "Public link shown during sign-up.",
    kind: "url",
    required: false,
    secret: false,
    isPublic: true,
    decode: sanitizedDecoder(
      (value) => decodePublicHttpUrl(value).href,
      "Privacy policy URL must use HTTP(S)",
    ),
  },
  {
    key: "terms_of_service_url",
    label: "Terms of Service URL",
    description: "Public link shown during sign-up.",
    kind: "url",
    required: false,
    secret: false,
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

export function configDefinition(key: string): ConfigDefinition | undefined {
  return definitionByKey.get(key)
}

export type ConfigValues = Partial<Record<ConfigKey, string>>

export interface ConfigIssue {
  key: ConfigKey
  message: string
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
        message: `${configDefinition(missing)?.label} is required to enable this sign-in provider`,
      })
    }
  }
  if (values.email_provider === "resend" && !values.resend_api_key) {
    issues.push({
      key: "resend_api_key",
      message: "Resend is the selected email provider but no Resend API key is configured",
    })
  }
  if (Boolean(values.aws_access_key_id) !== Boolean(values.aws_secret_access_key)) {
    const missing = values.aws_access_key_id ? "aws_secret_access_key" : "aws_access_key_id"
    issues.push({
      key: missing as ConfigKey,
      message: `${configDefinition(missing)?.label} is required to use static AWS credentials`,
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

export interface ConfigValueRow {
  key: string
  value: unknown
  updatedAt: Date
}

export interface ConfigSnapshot {
  version: string
  setupComplete: boolean
  appBaseUrl: string | null
  betterAuthSecret: string | null
  google: { clientId: string; clientSecret: string } | null
  github: { clientId: string; clientSecret: string } | null
  emailProvider: "resend" | "ses" | null
  emailFromAddress: string | null
  resendApiKey: string | null
  awsRegion: string | null
  awsAccessKeyId: string | null
  awsSecretAccessKey: string | null
  openaiApiKey: string | null
  chatAuthSecret: string | null
  privacyPolicyUrl: string
  termsOfServiceUrl: string
}

export function decodeStoredConfigValues(rows: { key: string; value: unknown }[]): ConfigValues {
  const values: ConfigValues = {}
  for (const row of rows) {
    const definition = definitionByKey.get(row.key)
    if (!definition) continue
    try {
      values[definition.key] = definition.decode(row.value)
    } catch {
      // Treat invalid stored values as unset; never surface them to requests.
      console.error(`Ignoring invalid stored config value for '${row.key}'`)
    }
  }
  return values
}

// `rows === null` means the config table does not exist yet (fresh database before migrations).
export function buildConfigSnapshot(rows: ConfigValueRow[] | null): ConfigSnapshot {
  const values = decodeStoredConfigValues(rows ?? [])
  const setupCompleted = (rows ?? []).some((row) =>
    row.key === SETUP_COMPLETED_KEY && row.value === true
  )
  const maxUpdatedAt = (rows ?? []).reduce(
    (max, row) => Math.max(max, row.updatedAt.getTime()),
    0,
  )
  const issues = validateConfigCompleteness(values)
  return {
    version: rows === null ? "unconfigured" : `${maxUpdatedAt}:${rows.length}`,
    setupComplete: setupCompleted && issues.length === 0,
    appBaseUrl: values.app_base_url ?? null,
    betterAuthSecret: values.better_auth_secret ?? null,
    google: values.google_client_id && values.google_client_secret
      ? { clientId: values.google_client_id, clientSecret: values.google_client_secret }
      : null,
    github: values.github_client_id && values.github_client_secret
      ? { clientId: values.github_client_id, clientSecret: values.github_client_secret }
      : null,
    emailProvider: (values.email_provider as "resend" | "ses" | undefined) ?? null,
    emailFromAddress: values.email_from_address ?? null,
    resendApiKey: values.resend_api_key ?? null,
    awsRegion: values.aws_region ?? null,
    awsAccessKeyId: values.aws_access_key_id ?? null,
    awsSecretAccessKey: values.aws_secret_access_key ?? null,
    openaiApiKey: values.openai_api_key ?? null,
    chatAuthSecret: values.chat_auth_secret ?? null,
    privacyPolicyUrl: values.privacy_policy_url ?? DEFAULT_PRIVACY_POLICY_URL,
    termsOfServiceUrl: values.terms_of_service_url ?? DEFAULT_TERMS_OF_SERVICE_URL,
  }
}

const CONFIG_CACHE_TTL_MS = 10_000

let configCache: { snapshot: ConfigSnapshot; expiresAt: number } | null = null
let configRefresh: Promise<ConfigSnapshot> | null = null
let configGeneration = 0

// Drizzle wraps driver failures in DrizzleQueryError, so the PostgreSQL code sits on a cause.
export function hasPostgresErrorCode(error: unknown, codes: readonly string[]): boolean {
  let current = error
  while (typeof current === "object" && current !== null) {
    const code = (current as { code?: unknown }).code
    if (typeof code === "string" && codes.includes(code)) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export function isMissingTableError(error: unknown): boolean {
  return hasPostgresErrorCode(error, ["42P01"])
}

async function readConfigRows(): Promise<ConfigValueRow[] | null> {
  // Dynamic import: db/index.server.ts imports DATABASE_URL from this module, so a static
  // back-import would be a module cycle.
  const { db } = await import("@/db/index.server")
  const { config } = await import("@/db/schema.server")
  try {
    return await db
      .select({ key: config.key, value: config.value, updatedAt: config.updatedAt })
      .from(config)
  } catch (error) {
    if (isMissingTableError(error)) return null
    throw error
  }
}

async function refreshConfig(): Promise<ConfigSnapshot> {
  const generation = configGeneration
  const snapshot = buildConfigSnapshot(await readConfigRows())
  if (generation === configGeneration) {
    configCache = { snapshot, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS }
  }
  return snapshot
}

export function getConfig(): Promise<ConfigSnapshot> {
  if (configCache && configCache.expiresAt > Date.now()) {
    return Promise.resolve(configCache.snapshot)
  }
  configRefresh ??= refreshConfig().finally(() => {
    configRefresh = null
  })
  return configRefresh
}

export function invalidateConfigCache(): void {
  configGeneration += 1
  configCache = null
}

export async function getRequiredConfig(): Promise<ConfigSnapshot> {
  const snapshot = await getConfig()
  if (!snapshot.setupComplete) throw new Error("Application setup is not complete")
  return snapshot
}

// API-route gate; page routes redirect to /configure from the root route instead.
export async function setupGateResponse(): Promise<Response | null> {
  const snapshot = await getConfig()
  if (snapshot.setupComplete) return null
  return Response.json(
    { error: "Application is not configured" },
    { status: 503, headers: { "retry-after": "10" } },
  )
}

// Derived only from provider-presence booleans and non-secret URLs; structurally secret-free.
export function publicConfigFromSnapshot(snapshot: ConfigSnapshot): PublicConfig {
  const enabledSocialProviders: PublicConfig["enabledSocialProviders"] = []
  if (snapshot.google) enabledSocialProviders.push("google")
  if (snapshot.github) enabledSocialProviders.push("github")
  return {
    enabledSocialProviders,
    privacyPolicyUrl: snapshot.privacyPolicyUrl,
    termsOfServiceUrl: snapshot.termsOfServiceUrl,
  }
}

export async function getPublicConfigSnapshot(): Promise<PublicConfig> {
  return publicConfigFromSnapshot(await getConfig())
}

export async function requireResendConfig() {
  const { resendApiKey } = await getConfig()
  if (!resendApiKey) {
    throw new Error("Resend is the selected email provider but no Resend API key is configured")
  }
  return { apiKey: resendApiKey }
}

export async function requireSesConfig() {
  const { awsRegion, awsAccessKeyId, awsSecretAccessKey } = await getConfig()
  if (!awsRegion) {
    throw new Error("SES is the selected email provider but no AWS region is configured")
  }
  return {
    region: awsRegion,
    // Static credentials apply only as a complete pair; otherwise the SDK credential chain wins.
    credentials: awsAccessKeyId && awsSecretAccessKey
      ? { accessKeyId: awsAccessKeyId, secretAccessKey: awsSecretAccessKey }
      : null,
  }
}
