import type { ConfigDefinition, ConfigIssue, ConfigKey, ConfigStorageEntry } from "@/lib/types"

export interface ConfigureField {
  key: ConfigKey
  group: ConfigDefinition["group"]
  label: string
  description: string
  kind: "text" | "url" | "secret" | "enum"
  required: boolean
  canGenerate: boolean
  isPublic: boolean
  environmentVariable: string
  source: "database" | "environment"
  options?: ConfigDefinition["options"]
  isSet: boolean
  storageStatus?: ConfigStorageEntry["storageStatus"]
  /** Effective value; the authenticated editor masks text, URL, and secret fields by default. */
  value: string | null
}

export type FieldDraft =
  | { kind: "unchanged" }
  | { kind: "set"; value: string }
  | { kind: "clear" }

export interface ConfigureFieldError {
  key: string
  message: string
}

export type ConfigurePageState =
  | {
    status: "unavailable"
    bootstrapIssues: readonly ("DATABASE_URL" | "DATABASE_ENCRYPTION_KEY")[]
  }
  | { status: "migrations-required" }
  | { status: "signed-out" }
  | {
    status: "ready"
    /** ISO instant the operator session expires at, for the live countdown. */
    sessionExpiresAt: string
    fallbackEncryptionKeyCount: number
    setupComplete: boolean
    fields: ConfigureField[]
    issues: ConfigIssue[]
  }
