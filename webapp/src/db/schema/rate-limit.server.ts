import { bigint, integer, snakeCase, text, uniqueIndex } from "drizzle-orm/pg-core"

import { timestamps, uuidV7PrimaryKey } from "../postgresql-types.server.ts"

export const rateLimit = snakeCase.table(
  "rate_limit",
  {
    id: uuidV7PrimaryKey(),
    key: text().notNull(),
    count: integer().notNull(),
    lastRequest: bigint({ mode: "number" }).notNull(),
    ...timestamps(),
  },
  (table) => [uniqueIndex("rate_limit_key_uidx").on(table.key)],
)
