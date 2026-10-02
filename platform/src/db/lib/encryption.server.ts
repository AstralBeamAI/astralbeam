import { hkdfSync } from "node:crypto"

import { Result, Schema } from "effect"

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

const DATABASE_ENCRYPTION_SALT = new TextEncoder().encode("database-encryption:hkdf-sha256:v1")
const DATABASE_ENCRYPTION_INFO = new TextEncoder().encode("database-encryption:a256gcm:v1")
const DATABASE_ENCRYPTION_KID_PATTERN = /^[\w-]{43}$/

function encryptDatabaseJson(options: {
  value: unknown
  keyring: DatabaseEncryptionKeyring
}): string | undefined {
  try {
    const serialized = JSON.stringify(options.value)
    if (serialized === undefined) return undefined
    const activeKey = options.keyring[0]
    return encryptCompactJwe({
      plaintext: new TextEncoder().encode(serialized),
      protectedHeader: { alg: "dir", enc: "A256GCM", kid: activeKey.kid },
      key: deriveDatabaseEncryptionKey(activeKey.root),
    })
  } catch {
    return undefined
  }
}

function decryptDatabaseJson(options: {
  storedValue: unknown
  keyring: DatabaseEncryptionKeyring
}): { value: unknown; usedFallbackKey: boolean } | undefined {
  if (typeof options.storedValue !== "string") return undefined
  let selectedKey: DatabaseKeyringEntry | undefined
  const decrypted = decryptCompactJwe({
    compactJwe: options.storedValue,
    resolveKey: (header) => {
      const kid = header.kid
      if (typeof kid !== "string" || !DATABASE_ENCRYPTION_KID_PATTERN.test(kid)) return undefined
      selectedKey = options.keyring.find((key) => key.kid === kid)
      return selectedKey && deriveDatabaseEncryptionKey(selectedKey.root)
    },
  })
  if (!selectedKey || !decrypted) return undefined
  try {
    return {
      value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decrypted.plaintext)),
      usedFallbackKey: selectedKey !== options.keyring[0],
    }
  } catch {
    return undefined
  }
}

function deriveDatabaseEncryptionKey(root: Uint8Array): Uint8Array {
  return new Uint8Array(
    hkdfSync("sha256", root, DATABASE_ENCRYPTION_SALT, DATABASE_ENCRYPTION_INFO, 32),
  )
}
