import { hkdfSync } from "node:crypto"

import { Predicate, Result, Schema } from "effect"

import { decryptCompactJwe, encryptCompactJwe } from "./compact-jwe.server.ts"
import type {
  DatabaseEncryptionKeyring,
  DatabaseKeyringEntry,
} from "./database-credentials.server.ts"

/** Every encryption failure reads alike, so it never describes or echoes the stored value. */
export class DatabaseEncryptionError extends Schema.TaggedError<DatabaseEncryptionError>()(
  "DatabaseEncryptionError",
  {},
) {
  override readonly message = "Stored database value could not be processed"
}

const DATABASE_ENCRYPTION_SALT = new TextEncoder().encode("database-encryption:hkdf-sha256:v1")
const DATABASE_ENCRYPTION_INFO = new TextEncoder().encode("database-encryption:a256gcm:v1")
const DATABASE_ENCRYPTION_KID_PATTERN = /^[\w-]{43}$/

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
  const serialized = Result.isSuccess(value) ? serializeDatabaseValue(value.success) : undefined
  if (serialized === undefined) return databaseEncryptionError
  const activeKey = options.keyring[0]
  return encryptCompactJwe({
    plaintext: new TextEncoder().encode(serialized),
    protectedHeader: { alg: "dir", enc: "A256GCM", kid: activeKey.kid },
    key: deriveDatabaseEncryptionKey(activeKey.root),
  }).pipe(Result.mapError(() => new DatabaseEncryptionError()))
}

export function decryptDatabaseValue<Value>(options: {
  storedValue: unknown
  schema: Schema.Decoder<Value>
  keyring: DatabaseEncryptionKeyring
}): Result.Result<DecryptedDatabaseValue<Value>, DatabaseEncryptionError> {
  if (!Predicate.isString(options.storedValue)) return databaseEncryptionError
  let selectedKey: DatabaseKeyringEntry | undefined
  const decrypted = decryptCompactJwe({
    compactJwe: options.storedValue,
    resolveKey: (header) => {
      const kid = header.kid
      if (!Predicate.isString(kid) || !DATABASE_ENCRYPTION_KID_PATTERN.test(kid)) return undefined
      selectedKey = options.keyring.find((key) => key.kid === kid)
      return selectedKey && deriveDatabaseEncryptionKey(selectedKey.root)
    },
  })
  const payload = Result.isSuccess(decrypted)
    ? parseDatabaseValue(decrypted.success.plaintext)
    : undefined
  const value = payload && decodeDatabaseValue(options.schema, payload.value)
  if (!selectedKey || !value || Result.isFailure(value)) return databaseEncryptionError
  return Result.succeed({
    value: value.success,
    usedFallbackKey: selectedKey !== options.keyring[0],
  })
}

function deriveDatabaseEncryptionKey(root: Uint8Array): Uint8Array {
  return new Uint8Array(
    hkdfSync("sha256", root, DATABASE_ENCRYPTION_SALT, DATABASE_ENCRYPTION_INFO, 32),
  )
}

function decodeDatabaseValue<Value>(schema: Schema.Decoder<Value>, value: unknown) {
  return Schema.decodeUnknownResult(schema, { onExcessProperty: "error" })(value)
}

const decodeDatabaseJson = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown))

// `JSON.stringify` returns undefined for values JSON cannot represent, such as a bare function.
function serializeDatabaseValue(value: unknown): string | undefined {
  return Result.getOrUndefined(
    Schema.encodeUnknownResult(Schema.fromJsonString(Schema.Unknown))(value),
  )
}

function parseDatabaseValue(plaintext: Uint8Array): { readonly value: unknown } | undefined {
  const text = Result.getOrUndefined(decodeUtf8(plaintext))
  const value = text === undefined ? undefined : decodeDatabaseJson(text)
  return value && Result.isSuccess(value) ? { value: value.success } : undefined
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true })

function decodeUtf8(bytes: Uint8Array): Result.Result<string, DatabaseEncryptionError> {
  // A fatal decoder throws on malformed UTF-8, the only failure this read can have.
  try {
    return Result.succeed(utf8Decoder.decode(bytes))
  } catch {
    return databaseEncryptionError
  }
}
