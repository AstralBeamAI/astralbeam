import { snakeCase, text, uniqueIndex } from "drizzle-orm/pg-core"
import { Schema } from "effect"

import { encryptedJson } from "../lib/encrypted-column.server.ts"
import { timestamps, uuidV7PrimaryKey } from "../lib/postgresql-types.server.ts"

const configValuePayloadSchema = Schema.Struct({
  key: Schema.String,
  value: Schema.String,
})

export const decodeConfigValuePayload = Schema.decodeUnknownSync(
  configValuePayloadSchema,
  { onExcessProperty: "error" },
)

// Global control-plane tables without an organizationId exist before any organization does.
export const configTable = snakeCase.table(
  "config",
  {
    id: uuidV7PrimaryKey(),
    key: text().notNull(),
    value: encryptedJson({
      decode: decodeConfigValuePayload,
    }).notNull(),
    ...timestamps(),
  },
  (table) => [uniqueIndex("config_key_uidx").on(table.key)],
)
