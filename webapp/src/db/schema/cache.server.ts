import { sql } from "drizzle-orm"
import { check, index, snakeCase, text, uniqueIndex } from "drizzle-orm/pg-core"

import { timestamps, timestampWithTimeZone, uuidV7PrimaryKey } from "../lib/columns.server.ts"

export const DATABASE_CACHE_NAMESPACE_MAX_LENGTH = 64
export const DATABASE_CACHE_KEY_MAX_LENGTH = 512

// Global infrastructure with caller-owned namespaces, not Organization-owned rows or cascade deletion.
// Callers authorize access and include immutable Organization/Tenant UUIDs in scoped keys. See ../../../../AGENTS.md.

// TTL hides expired entries from reads. Only explicit deleteDatabaseCache calls remove rows for now.
// Cleanup is deferred. Autovacuum reclaims deleted versions, not expired entries: https://www.postgresql.org/docs/18/routine-vacuuming.html
export const cacheEntry = snakeCase.table(
  "cache_entry",
  {
    // UUIDv7 follows repository conventions and gives each entry a stable row ID. A composite key could serve the KV contract.
    // Effect does not prescribe this table layout. See ../../../../AGENTS.md#database and ../lib/columns.server.ts.
    id: uuidV7PrimaryKey(),
    namespace: text().notNull(),
    key: text().notNull(),
    // toSchemaStore uses toCodecJson/fromJsonString. Store encoded JSON as text because no JSON-field queries are needed.
    // Schema validates values, including JSON null. https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.117/packages/effect/src/unstable/persistence/KeyValueStore.ts
    value: text().notNull(),
    // NULL means indefinite retention. Absolute timestamptz expiry uses the database clock rather than application clocks.
    // Writes add TTL to statement_timestamp(). https://www.postgresql.org/docs/18/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT
    expiresAt: timestampWithTimeZone(),
    // Standard diagnostic timestamps do not drive expiry. Upserts preserve createdAt and replace updatedAt.
    // Shared defaults and update behavior live in ../lib/columns.server.ts.
    ...timestamps(),
  },
  (table) => [
    // Bound characters on both indexed fields, allowing up to four UTF-8 bytes per character on standard 8 KiB pages.
    // https://www.postgresql.org/docs/18/btree.html
    check(
      "cache_entry_namespace_length",
      sql`char_length(${table.namespace}) <= ${DATABASE_CACHE_NAMESPACE_MAX_LENGTH}`,
    ),
    check(
      "cache_entry_key_length",
      sql`char_length(${table.key}) <= ${DATABASE_CACHE_KEY_MAX_LENGTH}`,
    ),
    // One value per namespace/key pair. This index supports exact reads and the atomic upsert conflict target.
    // https://www.postgresql.org/docs/18/sql-insert.html#SQL-ON-CONFLICT
    uniqueIndex("cache_entry_namespace_key_uidx").on(table.namespace, table.key),
    // Reserve an expiration-ordered index for future cleanup and omit indefinite entries.
    // https://www.postgresql.org/docs/18/indexes-ordering.html
    index("cache_entry_expires_at_idx")
      .on(table.expiresAt, table.id)
      .where(sql`${table.expiresAt} is not null`),
  ],
)
