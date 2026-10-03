import { createHash } from "node:crypto"
import { Effect, Exit, Option, Schema } from "effect"
import { SqlClient, SqlError } from "effect/sql"

import { makeDatabaseCache, tryWithDatabaseCacheLock } from "../cache.server.ts"
import { NonEmptyStringSchema, strictParseOptions } from "../../lib/schemas.ts"

const databaseIdempotencyRecordSchema = Schema.Struct({
  operation: Schema.String,
  parameters: Schema.Json,
  outcome: Schema.Json,
})
const databaseIdempotencyKeySchema = NonEmptyStringSchema.check(Schema.isMaxCodePoints(255))

export class IdempotencyParametersMismatch extends Schema.TaggedError<IdempotencyParametersMismatch>()(
  "IdempotencyParametersMismatch",
  {},
  { httpApiStatus: 400 },
) {
  override readonly message =
    "This idempotency key was used with a different operation or parameters"
}

export class IdempotencyInProgress extends Schema.TaggedError<IdempotencyInProgress>()(
  "IdempotencyInProgress",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "An operation with this idempotency key is still in progress"
}

export const withDatabaseIdempotency = Effect.fn("withDatabaseIdempotency")(function* <
  Parameters extends Schema.Constraint,
  Success extends Schema.Constraint,
  Failure extends Schema.Constraint,
  R,
>(
  options: {
    readonly namespace?: string
    readonly scope: string
    readonly key: string
    readonly operation: {
      readonly name: string
      readonly parameters: Parameters
      readonly success: Success
      readonly error: Failure
    }
    readonly parameters: unknown
  },
  execute: (parameters: Parameters["Type"]) => Effect.Effect<Success["Type"], Failure["Type"], R>,
) {
  const { namespace = "idempotency", scope, key: clientKey, operation, parameters: input } = options
  const { name, parameters: parameterSchema, success, error } = operation
  yield* Schema.decodeUnknownEffect(databaseIdempotencyKeySchema, strictParseOptions)(clientKey)
  const parameters = yield* Schema.decodeUnknownEffect(parameterSchema, strictParseOptions)(input)
  const parameterCodec = Schema.toCodecJson(parameterSchema)
  const encodedParameters = structuredClone(yield* Schema.encodeEffect(parameterCodec)(parameters))
  const outcomeCodec = Schema.toCodecJson(Schema.Result(success, error))
  const sql = yield* SqlClient.SqlClient
  if (Option.isSome(yield* Effect.serviceOption(sql.transactionService))) {
    return yield* Effect.die(
      new Error("Idempotency execution must start outside an existing transaction"),
    )
  }
  const cache = yield* makeDatabaseCache({
    namespace,
    schema: databaseIdempotencyRecordSchema,
    timeToLive: "24 hours",
  })
  const key = createHash("sha256")
    .update(JSON.stringify([scope, clientKey]))
    .digest("hex")
  const locked = yield* tryWithDatabaseCacheLock(
    { namespace, key },
    Effect.gen(function* () {
      const existing = yield* cache.get(key)
      if (Option.isSome(existing)) {
        if (existing.value.operation !== name) return yield* new IdempotencyParametersMismatch()
        const previous = yield* Schema.decodeUnknownEffect(parameterCodec)(
          existing.value.parameters,
        )
        if (!Schema.toEquivalence(Schema.toType(parameterSchema))(previous, parameters))
          return yield* new IdempotencyParametersMismatch()
        return yield* Schema.decodeUnknownEffect(outcomeCodec)(existing.value.outcome)
      }
      const exit = yield* Effect.exit(
        sql.withTransaction(Effect.suspend(() => execute(parameters))),
      )
      // Effect.result selects one failure, so first reject any infrastructure failure in the cause.
      // https://github.com/Effect-TS/effect/blob/effect%404.0.0/packages/effect/src/internal/effect.ts
      if (
        Exit.isFailure(exit) &&
        exit.cause.reasons.some(
          (reason) => reason._tag !== "Fail" || SqlError.isSqlError(reason.error),
        )
      ) {
        return yield* Effect.failCause(exit.cause)
      }
      const outcome = yield* Effect.result(exit)
      const encodedOutcome = yield* Schema.encodeUnknownEffect(outcomeCodec)(outcome)
      yield* cache.set(key, {
        operation: name,
        parameters: encodedParameters,
        outcome: encodedOutcome,
      })
      return yield* Schema.decodeUnknownEffect(outcomeCodec)(encodedOutcome)
    }),
  )
  if (Option.isNone(locked)) return yield* new IdempotencyInProgress()
  // Raise a recorded failure after commit, otherwise the failure would roll back its own record.
  // https://www.postgresql.org/docs/18/tutorial-transactions.html
  return yield* Effect.fromResult(locked.value)
})
