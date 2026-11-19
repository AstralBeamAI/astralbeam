import { uniqueIndex, primaryKey, snakeCase } from "drizzle-orm/pg-core"
import { Schema } from "effect"

import { encryptedJson, timestamps, uuidV7, text } from "../lib/columns.ts"

export const ConfigValuePayloadSchema = Schema.Struct({
  key: Schema.String,
  value: Schema.String,
})

// Global control-plane tables without an organizationId exist before any organization does.
export const configTable = snakeCase.table(
  "config",
  {
    id: uuidV7(),
    key: text().notNull(),
    value: encryptedJson({ schema: ConfigValuePayloadSchema }).notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "config_pkey", columns: [table.id] }),
    uniqueIndex("config_key_uidx").on(table.key),
  ],
)
