import { sql } from "drizzle-orm"
import { check, snakeCase, text, uniqueIndex } from "drizzle-orm/pg-core"
import { Schema } from "effect"

import { encryptedJson, schemaJsonb, timestamps, uuidV7PrimaryKey } from "../lib/columns.server.ts"
import { ModelPriceCatalogSchema } from "../../lib/model-providers/pricing-catalog-schemas.ts"

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
    value: encryptedJson({ schema: ConfigValuePayloadSchema }),
    jsonValue: schemaJsonb(Schema.toType(ModelPriceCatalogSchema)),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("config_key_uidx").on(table.key),
    check("config_value_check", sql`num_nonnulls(${table.value}, ${table.jsonValue}) = 1`),
  ],
)
