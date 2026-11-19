import { bigint, integer, text, uniqueIndex, primaryKey, snakeCase } from "drizzle-orm/pg-core"

import { timestamps, uuidV7 } from "../lib/columns.ts"

export const rateLimit = snakeCase.table(
  "rate_limit",
  {
    id: uuidV7(),
    key: text().notNull(),
    count: integer().notNull(),
    lastRequest: bigint({ mode: "number" }).notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "rate_limit_pkey", columns: [table.id] }),
    uniqueIndex("rate_limit_key_uidx").on(table.key),
  ],
)
