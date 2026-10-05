import { sql } from "drizzle-orm"
import {
  customType,
  foreignKey,
  integer,
  timestamp,
  uuid,
  type AnyPgColumn,
  type ForeignKey,
} from "drizzle-orm/pg-core"
import { Result, Schema } from "effect"

import {
  type DatabaseEncryptionKeyring,
  getDatabaseEncryptionKeyring,
} from "./database-credentials.server.ts"
import { decryptDatabaseValue, encryptDatabaseValue } from "./encryption.server.ts"

type EncryptedJsonOptions<Value> = {
  schema: Schema.Decoder<Value>
  keyring?: DatabaseEncryptionKeyring
}

type ForeignKeyDeferrability = "immediate" | "deferred"

// Drizzle retains the columns array on built constraints, so timing survives introspection.
// https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/foreign-keys.ts
const foreignKeyDeferrability = new WeakMap<
  ReturnType<ForeignKey["reference"]>["columns"],
  ForeignKeyDeferrability
>()

// Drizzle cannot represent deferrability. Preserve DEFERRABLE clauses in migration SQL.
// https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/foreign-keys.ts
export function deferrableForeignKey<
  TTableName extends string,
  TForeignTableName extends string,
  TColumns extends [
    AnyPgColumn<{ tableName: TTableName }>,
    ...AnyPgColumn<{ tableName: TTableName }>[],
  ],
>(options: {
  name?: string
  columns: TColumns
  foreignColumns: { [Key in keyof TColumns]: AnyPgColumn<{ tableName: TForeignTableName }> }
  deferrable?: ForeignKeyDeferrability
}) {
  const { deferrable = "immediate", ...reference } = options
  const columns: TColumns = [...reference.columns]
  foreignKeyDeferrability.set(columns, deferrable)
  return foreignKey({ ...reference, columns })
}

export function getForeignKeyDeferrability(constraint: ForeignKey) {
  return foreignKeyDeferrability.get(constraint.reference().columns)
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
  // Drizzle codecs are synchronous and report failures only by throwing.
  const decodeStoredValue = (storedValue: string) =>
    Result.getOrThrow(
      decryptDatabaseValue({ storedValue, schema: options.schema, keyring: keyring() }),
    ).value
  return customType<{ data: Value; driverData: string; jsonData: string }>({
    dataType: () => "text",
    toDriver: (value) =>
      Result.getOrThrow(
        encryptDatabaseValue({ value, schema: options.schema, keyring: keyring() }),
      ),
    fromDriver: decodeStoredValue,
    fromJson: decodeStoredValue,
  })()
}

class DatabaseJsonError extends Schema.TaggedError<DatabaseJsonError>()("DatabaseJsonError", {}) {
  override readonly message = "Database JSON does not match its column schema"
}

export function schemaJsonb<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S) {
  const codec = Schema.toCodecJson(schema)
  const decode = (value: unknown) =>
    Result.getOrThrow(
      Schema.decodeUnknownResult(codec, { onExcessProperty: "error" })(value).pipe(
        Result.mapError(() => new DatabaseJsonError()),
      ),
    )
  return customType<{
    data: S["Type"]
    driverData: string
    driverOutput: unknown
    jsonData: unknown
  }>({
    dataType: () => "jsonb",
    toDriver: (value) =>
      JSON.stringify(
        Result.getOrThrow(
          Schema.encodeUnknownResult(codec, { onExcessProperty: "error" })(value).pipe(
            Result.mapError(() => new DatabaseJsonError()),
          ),
        ),
      ),
    fromDriver: decode,
    fromJson: decode,
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
  return uuid()
    .default(sql`uuidv7()`)
    .notNull()
}

export function uuidV7PrimaryKey() {
  return uuidV7().primaryKey()
}
