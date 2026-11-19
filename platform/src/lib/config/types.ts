import type { Schema } from "effect"
import type { CONFIG_DEFINITIONS } from "./registry.ts"

// The non-secret slice of the database-backed runtime configuration that the client may see.
export interface PublicConfig {
  enabledSocialProviders: ("google" | "github")[]
  requireEmailVerification: boolean
  turnstileSiteKey: string
  privacyPolicyUrl: string | undefined
  termsOfServiceUrl: string | undefined
  supportEmailAddress: string
  hasWebsite: boolean
}

export type ConfigKey = (typeof CONFIG_DEFINITIONS)[number]["key"]

export interface ConfigDefinition<Key extends string = ConfigKey> {
  /** System-managed database-only value, never editable or revealable through generic configuration. */
  systemManaged?: true
  key: Key
  group:
    | "General"
    | "Authentication"
    | "Models"
    | "Email Delivery"
    | "File storage"
    | "Observability"
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
