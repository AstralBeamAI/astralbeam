import { sql } from "drizzle-orm"
import { customType, integer, timestamp, uuid } from "drizzle-orm/pg-core"

import {
  type DatabaseEncryptionKeyring,
  getDatabaseEncryptionKeyring,
} from "./database-credentials.server.ts"
import { decryptDatabaseValue, encryptDatabaseValue } from "./encryption.server.ts"

type EncryptedJsonOptions<Value> = {
  decode: (value: unknown) => Value
  keyring?: DatabaseEncryptionKeyring
}

// The migration installs PostgreSQL's trusted citext extension before creating these columns. https://www.postgresql.org/docs/current/citext.html
export const caseInsensitiveText = customType<{ data: string }>({
  dataType: () => "citext",
})

/**
 * Creates a transparent encrypted text column.
 * Include dynamic row identity in object values and compare it with sibling columns after reads.
 */
export function encryptedJson<Value>(options: EncryptedJsonOptions<Value>) {
  const keyring = () => options.keyring ?? getDatabaseEncryptionKeyring()
  const decodeStoredValue = (storedValue: string) =>
    decryptDatabaseValue({
      storedValue,
      decode: options.decode,
      keyring: keyring(),
    }).value
  return customType<{ data: Value; driverData: string; jsonData: string }>({
    dataType: () => "text",
    toDriver: (value) =>
      encryptDatabaseValue({
        value,
        decode: options.decode,
        keyring: keyring(),
      }),
    fromDriver: decodeStoredValue,
    fromJson: decodeStoredValue,
  })()
}

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

export function uuidV7() {
  // PostgreSQL 18 provides the database default until Drizzle adds a UUIDv7 helper. https://github.com/drizzle-team/drizzle-orm/issues/5721
  return uuid().default(sql`uuidv7()`).notNull()
}

export function uuidV7PrimaryKey() {
  return uuidV7().primaryKey()
}
