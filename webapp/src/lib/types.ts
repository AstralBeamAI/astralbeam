// An enum config choice: `value` is stored in the database, `label` is shown in the /configure editor.
export interface ConfigOption {
  value: string
  label: string
}

// The non-secret slice of the database-backed runtime configuration that the client may see.
export interface PublicConfig {
  enabledSocialProviders: ("google" | "github")[]
  privacyPolicyUrl: string
  termsOfServiceUrl: string
}

export type ConfigKey =
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

export interface ConfigDefinition {
  key: ConfigKey
  label: string
  description: string
  kind: "text" | "url" | "secret" | "enum"
  required: boolean
  secret: boolean
  /** The stored value is visible to end users (public pages or browser-visible URLs). */
  isPublic?: true
  options?: readonly ConfigOption[]
  decode: (value: unknown) => string
  generate?: () => string
}

export type ConfigValues = Partial<Record<ConfigKey, string>>

export interface ConfigIssue {
  key: ConfigKey
  message: string
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
