import { getColumnRefinements } from "@/db/lib/columns"
import { LockVersionSchema } from "@/lib/schemas"
import {
  and,
  eq,
  getTableColumns,
  type InferInsertModel,
  type InferSelectModel,
  type SQL,
} from "drizzle-orm"
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-orm/effect-schema"
import {
  primaryKey as nativePrimaryKey,
  getTableConfig,
  type PrimaryKeyBuilder,
  type AnyPgColumn,
  snakeCase,
  type AnyPgColumnBuilder,
  type AnyPgTable,
  type PgBuildExtraConfigColumns,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core"
import { Data, Effect, Function, Predicate, Schema, Struct } from "effect"

// Database imports the model definitions. Resolve it when a write runs.
const modelDatabase = Effect.flatMap(
  Effect.promise(() => import("@/db/database")),
  ({ Database }) => Database,
)

export function withTransaction<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.flatMap(modelDatabase, (db) => db.$client.withTransaction(effect))
}

type Row<T extends AnyPgTable> = InferSelectModel<T>
type Name<T extends AnyPgTable> = keyof Row<T> & string
type ModelTable<
  TableName extends string,
  Columns extends Record<string, AnyPgColumnBuilder>,
> = ReturnType<typeof snakeCase.table<TableName, Columns>>
type Identity<T extends AnyPgTable, K extends Name<T>> = Pick<Row<T>, K> &
  ("lockVersion" extends Name<T>
    ? { readonly lockVersion: number }
    : { readonly lockVersion?: never })
type Locked<T extends AnyPgTable, E, R> = {
  readonly onLocked?: (row: Readonly<Row<T>>) => Effect.Effect<unknown, E, R>
  readonly where?: SQL | undefined
}
class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly phase: string
}> {
  override readonly message = "The record does not satisfy its validation rules"
}
class NotFound extends Data.TaggedError("NotFound") {}
class StaleWrite extends Data.TaggedError("StaleWrite") {}
const invalid = (phase: string) => new ValidationError({ phase })
function validate<A>(schema: Schema.Codec<A>, value: unknown, phase: string) {
  return Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(value).pipe(
    Effect.mapError(() => invalid(phase)),
  )
}

function copySupportedValue<T>(value: T): T {
  const seen = new Set<object>()
  const copy = (input: unknown): unknown => {
    if (typeof input === "function" || typeof input === "symbol") {
      throw new TypeError("Unsupported model value")
    }
    if (typeof input !== "object" || input === null) return input
    if (input instanceof Date) return new Date(Date.prototype.getTime.call(input))
    if (seen.has(input)) throw new TypeError("Cyclic model value")
    const prototype: unknown = Object.getPrototypeOf(input)
    const array = Array.isArray(input)
    if (
      array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
    ) {
      throw new TypeError("Unsupported model value")
    }
    seen.add(input)
    try {
      const output = array ? Object.assign([], { length: input.length }) : {}
      for (const key of Reflect.ownKeys(input)) {
        if (array && key === "length") continue
        if (
          typeof key !== "string" ||
          (array && (!/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= input.length))
        )
          throw new TypeError("Unsupported model key")
        Object.defineProperty(output, key, {
          value: copy(Reflect.get(input, key)),
          enumerable: true,
          configurable: true,
          writable: true,
        })
      }
      return output
    } finally {
      seen.delete(input)
    }
  }
  return copy(value) as T
}

function capture(value: unknown, keys?: readonly string[]) {
  try {
    const snapshot = copySupportedValue(
      keys && Predicate.isObject(value)
        ? Object.fromEntries(
            keys
              .filter((key) => Object.hasOwn(value, key))
              .map((key) => [key, Reflect.get(value, key)]),
          )
        : value,
    )
    return Effect.sync(() => structuredClone(snapshot))
  } catch {
    return Effect.fail(invalid("input"))
  }
}

const modelProperties = ["schema", "insert", "update", "delete"] as const

// Compile-only markers retain the selected keys that native constraint builders erase.
declare const columnKey: unique symbol
declare const primaryKeys: unique symbol
type ModelColumns<C extends Record<string, AnyPgColumnBuilder>> = {
  [P in keyof C]: PgBuildExtraConfigColumns<C>[P] & { readonly [columnKey]: P }
}
type KeyColumn = AnyPgColumn & { readonly [columnKey]: PropertyKey }
type ModelPrimaryKey<K> = PrimaryKeyBuilder & { readonly [primaryKeys]: K }
type ModelConstraint = Exclude<PgTableExtraConfigValue, PrimaryKeyBuilder>

export const primaryKey = nativePrimaryKey as <
  const C extends [KeyColumn, ...KeyColumn[]],
>(config: {
  columns: C
  name?: string
}) => ModelPrimaryKey<C[number][typeof columnKey]>

export function defineTable<
  TableName extends string,
  Columns extends Record<string, AnyPgColumnBuilder>,
  const K extends Name<ModelTable<TableName, Columns>>,
>(
  name: TableName,
  columns: Columns & { readonly [P in (typeof modelProperties)[number]]?: never },
  constraints: (
    table: ModelColumns<Columns>,
  ) => [ModelPrimaryKey<K>, ...(ModelConstraint | ModelConstraint[])[]],
) {
  if (modelProperties.some((name) => Object.hasOwn(columns, name)))
    throw new Error("Model columns cannot use schema, insert, update or delete")
  const table = snakeCase.table<TableName, Columns>(name, columns, (fields) =>
    constraints(fields as ModelColumns<Columns>),
  )
  type T = typeof table
  const native: AnyPgTable = table
  const tableColumns = getTableColumns(native)
  const version = tableColumns.lockVersion
  if (
    version &&
    (version.columnType !== "PgInteger" ||
      !version.notNull ||
      version.generated ||
      version.generatedIdentity)
  )
    throw new Error("lockVersion must be a mutable nonnullable integer outside the primary key")
  const refinements = getColumnRefinements(columns)
  if (version)
    refinements.lockVersion = (base) => base.check(Schema.makeFilter(Schema.is(LockVersionSchema)))
  const insertSchema = createInsertSchema(native, refinements as object)
  const nativeState = createSelectSchema(native, refinements)
  const schema = nativeState as unknown as Schema.Struct<{
    [P in Name<T>]: Schema.Codec<Row<T>[P]>
  }> &
    Schema.Codec<Row<T>>
  const prepare = Function.memoize((native: AnyPgTable) => {
    const primaryKeys = getTableConfig(native).primaryKeys
    const names = new Map(Object.entries(tableColumns).map(([name, column]) => [column.name, name]))
    const key = primaryKeys[0]?.columns.map((column) => names.get(column.name) ?? "") ?? []
    if (
      primaryKeys.length !== 1 ||
      !key.includes("id") ||
      new Set(key).size !== key.length ||
      key.some((name) => !tableColumns[name]?.notNull || name === "lockVersion")
    )
      throw new Error(
        "The primary key must include id, contain only nonnullable columns, and exclude lockVersion",
      )
    const identityFields = [...key, "lockVersion"]
    const patchSchema = (
      createUpdateSchema(native, refinements) as Schema.Struct<
        Record<string, Schema.Codec<unknown>>
      >
    ).mapFields(Struct.omit(identityFields))
    const keySchema = nativeState.mapFields(Struct.pick(key))
    const identitySchema = version ? nativeState.mapFields(Struct.pick(identityFields)) : keySchema
    const keyColumns = Struct.pick(tableColumns, key)
    return { identityFields, patchSchema, keySchema, identitySchema, keyColumns }
  })
  function command<Operation extends "insert" | "update" | "delete", E = never, R = never>(
    operation: Operation,
    identityInput: unknown,
    input: unknown,
    { onLocked, where: scope }: Locked<T, E, R> = {},
  ) {
    const { identityFields, patchSchema, keySchema, identitySchema, keyColumns } = prepare(native)
    const capturedKey = operation === "insert" ? undefined : capture(identityInput, identityFields)
    const capturedInput = capture(input)
    const resultSchema = (operation === "delete" ? keySchema : schema) as unknown as Schema.Codec<
      Operation extends "delete" ? Pick<Row<T>, K> : Row<T>
    >
    return Effect.gen(function* () {
      const values = yield* capturedInput
      if (
        !Predicate.isObject(values) ||
        Object.getPrototypeOf(values) !== Object.prototype ||
        Object.values(values).includes(undefined)
      )
        return yield* invalid("input")
      const patch =
        operation === "delete"
          ? {}
          : yield* validate(
              operation === "insert" ? insertSchema : patchSchema,
              values,
              operation === "insert" ? "insert" : "patch",
            )
      const fields = Object.keys(patch)
      if (operation === "update" && !version && fields.length === 0) return yield* invalid("patch")
      const identity = capturedKey && (yield* validate(identitySchema, yield* capturedKey, "key"))
      const expected = identity?.lockVersion
      const changes = typeof expected === "number" ? { ...patch, lockVersion: expected + 1 } : patch
      const where = identity
        ? and(
            scope,
            ...Object.entries(keyColumns).map(([name, column]) => eq(column, identity[name])),
          )
        : undefined
      const db = yield* modelDatabase
      return yield* db.$client.withTransaction(
        Effect.gen(function* () {
          if (operation === "update" || onLocked) {
            const selected = onLocked ? tableColumns : Struct.omit(tableColumns, fields)
            const [current] = yield* db.select(selected).from(native).where(where).for("update")
            if (!current) return yield* new NotFound()
            if (onLocked) yield* onLocked(copySupportedValue(current as Row<T>))
            if (version && (current as { lockVersion?: number }).lockVersion !== expected)
              return yield* new StaleWrite()
            if (operation === "update")
              yield* validate(schema, { ...current, ...changes }, "candidate")
          }
          const guarded = version && identity ? and(where, eq(version, expected)) : where
          const rows = yield* operation === "insert"
            ? db.insert(native).values(patch).returning(tableColumns)
            : operation === "update"
              ? db.update(native).set(changes).where(guarded).returning(tableColumns)
              : db.delete(native).where(guarded).returning(keyColumns)
          const row = rows[0]
          if (!row) return yield* new NotFound()
          return yield* validate(resultSchema, row, "persisted")
        }),
      )
    }).pipe(Effect.withSpan(`Model.${name}.${operation}`))
  }
  return Object.assign(table, {
    schema,
    insert: (input: InferInsertModel<T>) =>
      command("insert", {}, input).pipe(Effect.catchTag(["NotFound", "StaleWrite"], Effect.die)),
    update: <E = never, R = never>(
      key: Identity<T, K>,
      patch: Partial<Omit<InferInsertModel<T>, K | "lockVersion">>,
      options?: Locked<T, E, R>,
    ) => command("update", key, patch, options),
    delete: <E = never, R = never>(key: Identity<T, K>, options?: Locked<T, E, R>) =>
      command("delete", key, {}, options),
  })
}
