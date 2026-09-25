import type { Schema } from "effect"

// The non-secret slice of the database-backed runtime configuration that the client may see.
export interface PublicConfig {
  enabledSocialProviders: ("google" | "github")[]
  turnstileSiteKey: string
  privacyPolicyUrl: string | undefined
  termsOfServiceUrl: string | undefined
}

export type ConfigKey =
  | "dogfood_organization_id"
  | "dogfood_api_key"
  | "dogfood_pending_setup"
  | "app_base_url"
  | "better_auth_secret"
  | "google_client_id"
  | "google_client_secret"
  | "github_client_id"
  | "github_client_secret"
  | "turnstile_site_key"
  | "turnstile_secret_key"
  | "email_provider"
  | "email_from_address"
  | "smtp_host"
  | "smtp_port"
  | "smtp_security"
  | "smtp_username"
  | "smtp_password"
  | "resend_api_key"
  | "aws_region"
  | "aws_access_key_id"
  | "aws_secret_access_key"
  | "privacy_policy_url"
  | "terms_of_service_url"

export interface ConfigDefinition {
  /** System-managed database-only value, never editable or revealable through generic configuration. */
  systemManaged?: true
  key: ConfigKey
  group: "General" | "Authentication" | "Email Delivery"
  label: string
  description: string
  kind: "text" | "url" | "secret" | "enum"
  required: boolean
  /** Effective value used when neither the database nor environment configures the key. */
  defaultValue?: string
  /** The stored value is visible to end users (public pages or browser-visible URLs). */
  isPublic?: true
  options?: readonly { value: string; label: string }[]
  schema: Schema.Decoder<string>
  generate?: () => string
}

export type ConfigValues = Partial<Record<ConfigKey, string | undefined>>

export interface ConfigIssue {
  key: ConfigKey
  message: string
}

export interface ConfigStorageEntry {
  key: string
  storageStatus?: "fallback-key" | "unreadable"
}
