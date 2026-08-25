import type { ConfigOption } from "@/lib/config"

export interface ConfigureField {
  key: string
  label: string
  description: string
  kind: "text" | "url" | "secret" | "enum"
  required: boolean
  secret: boolean
  isPublic: boolean
  options?: readonly ConfigOption[]
  canGenerate: boolean
  isSet: boolean
  /** Stored string value, null when unset; delivered only to authenticated operators. */
  value: string | null
}

// Saving an empty "set" draft clears the stored value.
export type FieldDraft =
  | { kind: "unchanged" }
  | { kind: "set"; value: string }

export interface PendingMigrationInfo {
  name: string
  sql: string
}

export interface ConfigureIssue {
  key: string
  message: string
}

export type ConfigureState =
  | { authenticated: false; setupComplete: boolean }
  | {
    authenticated: true
    dbUsername: string
    setupComplete: boolean
    migrations: { pending: PendingMigrationInfo[]; appliedCount: number }
    fields: ConfigureField[]
    issues: ConfigureIssue[]
  }
