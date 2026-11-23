import { uniqueIndex } from "drizzle-orm/pg-core"
import { Schema } from "effect"
import { defineModel, primaryKey } from "@/lib/persistence.server"

import { encryptedJson, timestamps, uuidV7, text } from "../lib/columns.ts"

export const ConfigValuePayloadSchema = Schema.Struct({
  key: Schema.String,
  value: Schema.String,
})

// Global control-plane tables without an organizationId exist before any organization does.
export const configTable = defineModel(
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
