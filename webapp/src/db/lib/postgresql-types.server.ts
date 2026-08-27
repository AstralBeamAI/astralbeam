import { sql } from "drizzle-orm"
import { customType, integer, timestamp, uuid } from "drizzle-orm/pg-core"

// The migration installs PostgreSQL's trusted citext extension before creating these columns. https://www.postgresql.org/docs/current/citext.html
export const caseInsensitiveText = customType<{ data: string }>({
  dataType: () => "citext",
})

export function timestampWithTimeZone() {
  return timestamp({ withTimezone: true })
}

export function timestamps() {
  // This is a Drizzle runtime hook, not a PostgreSQL trigger; non-Drizzle updates must set the column explicitly. https://orm.drizzle.team/docs/column-types
  return {
    createdAt: timestampWithTimeZone().defaultNow().notNull(),
    updatedAt: timestampWithTimeZone()
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => sql`now()`),
  }
}

export function lockVersion() {
  return integer().default(0).notNull()
}

export function uuidV7PrimaryKey() {
  // PostgreSQL 18 provides the database default until Drizzle adds a UUIDv7 helper. https://github.com/drizzle-team/drizzle-orm/issues/5721
  return uuid().default(sql`uuidv7()`).primaryKey()
}
