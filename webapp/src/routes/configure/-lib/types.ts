export interface ConfigureField {
  key: string
  label: string
  description: string
  kind: "text" | "url" | "secret" | "enum"
  required: boolean
  secret: boolean
  options?: readonly string[]
  canGenerate: boolean
  isSet: boolean
  /** Stored value for non-secret fields; always null for secrets. */
  value: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export type FieldDraft =
  | { kind: "unchanged" }
  | { kind: "set"; value: string }
  | { kind: "clear" }

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
