import { bigint, integer, uniqueIndex } from "drizzle-orm/pg-core"
import { defineModel, primaryKey } from "@/lib/persistence.server"

import { timestamps, uuidV7, text } from "../lib/columns.ts"

export const rateLimit = defineModel(
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
