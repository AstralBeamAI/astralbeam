import { Result, Schema } from "effect"

import { decryptDatabaseJson, encryptDatabaseJson } from "./database-cipher.server.ts"
import type { DatabaseEncryptionKeyring } from "./database-credentials.server.ts"

/** Every encryption failure reads alike, so it never describes or echoes the stored value. */
export class DatabaseEncryptionError extends Schema.TaggedError<DatabaseEncryptionError>()(
  "DatabaseEncryptionError",
  {},
) {
  override readonly message = "Stored database value could not be processed"
}

type DecryptedDatabaseValue<Value> = {
  value: Value
  usedFallbackKey: boolean
}

const databaseEncryptionError = Result.fail(new DatabaseEncryptionError())

/** Validates the value against its column schema before encrypting it with the active key. */
export function encryptDatabaseValue<Value>(options: {
  value: unknown
  schema: Schema.Decoder<Value>
  keyring: DatabaseEncryptionKeyring
}): Result.Result<string, DatabaseEncryptionError> {
  const value = decodeDatabaseValue(options.schema, options.value)
  const encrypted = Result.isSuccess(value)
    ? encryptDatabaseJson({ value: value.success, keyring: options.keyring })
    : undefined
  return encrypted === undefined ? databaseEncryptionError : Result.succeed(encrypted)
}

export function decryptDatabaseValue<Value>(options: {
  storedValue: unknown
  schema: Schema.Decoder<Value>
  keyring: DatabaseEncryptionKeyring
}): Result.Result<DecryptedDatabaseValue<Value>, DatabaseEncryptionError> {
  const payload = decryptDatabaseJson(options)
  const value = payload && decodeDatabaseValue(options.schema, payload.value)
  if (!payload || !value || Result.isFailure(value)) return databaseEncryptionError
  return Result.succeed({
    value: value.success,
    usedFallbackKey: payload.usedFallbackKey,
  })
}

function decodeDatabaseValue<Value>(schema: Schema.Decoder<Value>, value: unknown) {
  return Schema.decodeUnknownResult(schema, { onExcessProperty: "error" })(value)
}
