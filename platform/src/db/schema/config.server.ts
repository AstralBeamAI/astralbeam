import { snakeCase, text, uniqueIndex } from "drizzle-orm/pg-core"
import { Schema } from "effect"

import { encryptedJson, timestamps, uuidV7PrimaryKey } from "../lib/columns.server.ts"

export const ConfigValuePayloadSchema = Schema.Struct({
  key: Schema.String,
  value: Schema.String,
})

// Global control-plane tables without an organizationId exist before any organization does.
export const configTable = snakeCase.table(
  "config",
  {
    id: uuidV7PrimaryKey(),
    key: text().notNull(),
    value: encryptedJson({ schema: ConfigValuePayloadSchema }).notNull(),
    ...timestamps(),
  },
  (table) => [uniqueIndex("config_key_uidx").on(table.key)],
)
