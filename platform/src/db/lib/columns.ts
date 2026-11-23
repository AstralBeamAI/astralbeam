import { sql, type InferSelectModel } from "drizzle-orm"
import { createSelectSchema as drizzleSelectSchema } from "drizzle-orm/effect-schema"
import {
  customType,
  foreignKey,
  integer,
  text as drizzleText,
  timestamp,
  uuid,
  type AnyPgColumn,
  type AnyPgColumnBuilder,
  type AnyPgTable,
  type ForeignKey,
  type PgBuildColumn,
  type PgTextBuilder,
  type PgTextConfig,
  type SetHasDefault,
  type SetNotNull,
} from "drizzle-orm/pg-core"
import { Result, Schema } from "effect"
import { LockVersionSchema, UuidV7Schema } from "@/lib/schemas"

import {
  type DatabaseEncryptionKeyring,
  getDatabaseEncryptionKeyring,
} from "./database-credentials.ts"
import { decryptDatabaseValue, encryptDatabaseValue } from "./encryption.ts"

type EncryptedJsonOptions<Value> = {
  schema: Schema.Decoder<Value>
  keyring?: DatabaseEncryptionKeyring
}

const columnSchemas = new WeakMap<AnyPgColumnBuilder, Schema.Constraint>()

type ColumnSchemaType<Value> = Value extends readonly unknown[]
  ? { readonly [P in keyof Value]: ColumnSchemaType<Value[P]> }
  : Value

function schemaColumn<C extends AnyPgColumnBuilder>(
  column: C,
  schema: Schema.Constraint & {
    readonly Type:
      | PgBuildColumn<string, C>["_"]["data"]
      | ColumnSchemaType<PgBuildColumn<string, C>["_"]["data"]>
  },
): C {
  columnSchemas.set(column, schema)
  return column
}

export function createSelectSchema<T extends AnyPgTable>(
  table: T,
  columns: Record<keyof InferSelectModel<T>, AnyPgColumnBuilder>,
) {
  const refinements: Record<string, (base: Schema.Codec<unknown>) => Schema.Codec<unknown>> = {}
  for (const [name, builder] of Object.entries<AnyPgColumnBuilder>(columns)) {
    const schema = columnSchemas.get(builder)
    if (!schema) continue
    const decode = Schema.decodeUnknownResult(Schema.toType(schema), { onExcessProperty: "error" })
    refinements[name] = (base) =>
      base.check(Schema.makeFilter((value) => Result.isSuccess(decode(value))))
  }
  type Row = InferSelectModel<T>
  const native: AnyPgTable = table
  return drizzleSelectSchema(native, refinements) as unknown as Schema.Struct<{
    [Name in keyof Row]: Schema.Codec<Row[Name]>
  }>
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

type TextSchemaOptions = { readonly schema?: Schema.ConstraintDecoder<string> | undefined }
type TextOptions = TextSchemaOptions & PgTextConfig<readonly [string, ...string[]]>

export function text<const Values extends readonly [string, ...string[]]>(
  options: TextSchemaOptions & { readonly enum: Values },
): PgTextBuilder<[...Values]>
export function text(options?: TextOptions): PgTextBuilder
export function text({ schema, ...config }: TextOptions = {}): AnyPgColumnBuilder {
  const column = drizzleText(config)
  return schema ? schemaColumn(column, schema) : column
}

// The migration installs PostgreSQL's trusted citext extension before creating these columns. https://www.postgresql.org/docs/current/citext.html
export function caseInsensitiveText({ schema = Schema.String }: TextSchemaOptions = {}) {
  return schemaColumn(customType<{ data: string }>({ dataType: () => "citext" })(), schema)
}

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
  return schemaColumn(
    customType<{ data: Value; driverData: string; jsonData: string }>({
      dataType: () => "text",
      toDriver: (value) =>
        Result.getOrThrow(
          encryptDatabaseValue({ value, schema: options.schema, keyring: keyring() }),
        ),
      fromDriver: decodeStoredValue,
      fromJson: decodeStoredValue,
    })(),
    options.schema,
  )
}

class DatabaseJsonError extends Schema.TaggedError<
  DatabaseJsonError,
  { readonly brand: unique symbol }
>()("DatabaseJsonError", {}) {
  override readonly message = "Database JSON does not match its column schema"
}

export function jsonb<S extends Schema.ConstraintCodec<unknown, unknown>>({
  schema,
}: {
  readonly schema: S
}) {
  const codec = Schema.toCodecJson(schema)
  const options = { onExcessProperty: "error" } as const
  const encode = Schema.encodeUnknownResult(codec, options)
  const decode = Schema.decodeUnknownResult(codec, options)
  const fail = () => new DatabaseJsonError()
  const fromDriver = (value: unknown) => Result.getOrThrowWith(decode(value), fail)
  return schemaColumn(
    customType<{
      data: S["Type"]
      driverData: string
      driverOutput: unknown
      jsonData: unknown
    }>({
      dataType: () => "jsonb",
      toDriver: (value) => JSON.stringify(Result.getOrThrowWith(encode(value), fail)),
      fromDriver,
      fromJson: fromDriver,
    })(),
    schema,
  )
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
  return schemaColumn(integer().default(0).notNull(), LockVersionSchema)
}

export function uuidV7(options: { generated: false }): ReturnType<typeof uuid>
export function uuidV7(options?: {
  generated?: true
}): SetNotNull<SetHasDefault<ReturnType<typeof uuid>>>
export function uuidV7({ generated = true }: { generated?: boolean } = {}) {
  const column = schemaColumn(uuid(), UuidV7Schema)
  // PostgreSQL 18 provides the database default until Drizzle adds a UUIDv7 helper. https://github.com/drizzle-team/drizzle-orm/issues/5721
  return generated ? column.default(sql`uuidv7()`).notNull() : column
}
