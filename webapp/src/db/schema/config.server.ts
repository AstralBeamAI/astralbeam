import { jsonb, snakeCase, text, uniqueIndex } from "drizzle-orm/pg-core"

import { timestamps, timestampWithTimeZone, uuidV7PrimaryKey } from "../postgresql-types.server.ts"

// Global control-plane tables without an organizationId: runtime configuration and operator
// sessions exist before any organization does and are managed by the deployment operator.
export const configTable = snakeCase.table(
  "config",
  {
    id: uuidV7PrimaryKey(),
    key: text().notNull(),
    value: jsonb().notNull(),
    // Database username of the operator session that wrote the row; null for programmatic writes.
    updatedBy: text(),
    ...timestamps(),
  },
  (table) => [uniqueIndex("config_key_uidx").on(table.key)],
)

export const configSession = snakeCase.table(
  "config_session",
  {
    id: uuidV7PrimaryKey(),
    tokenHash: text().notNull(),
    dbUsername: text().notNull(),
    expiresAt: timestampWithTimeZone().notNull(),
    ...timestamps(),
  },
  (table) => [uniqueIndex("config_session_token_hash_uidx").on(table.tokenHash)],
)
