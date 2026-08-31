import { hkdfSync } from "node:crypto"

import * as Data from "effect/Data"

import { decryptCompactJwe, encryptCompactJwe } from "./compact-jwe.server.ts"
import type {
  DatabaseEncryptionKeyring,
  DatabaseKeyringEntry,
} from "./database-credentials.server.ts"

class DatabaseEncryptionError extends Data.TaggedError("DatabaseEncryptionError")<{
  readonly message: string
}> {}

const DATABASE_ENCRYPTION_SALT = new TextEncoder().encode(
  "database-encryption:hkdf-sha256:v1",
)
const DATABASE_ENCRYPTION_INFO = new TextEncoder().encode("database-encryption:a256gcm:v1")
const DATABASE_ENCRYPTION_KID_PATTERN = /^[\w-]{43}$/

type DecryptedDatabaseValue<Value> = {
  value: Value
  usedFallbackKey: boolean
}

type EncryptDatabaseValueOptions<Value> = {
  value: unknown
  decode: (value: unknown) => Value
  keyring: DatabaseEncryptionKeyring
}

type DecryptDatabaseValueOptions<Value> = {
  storedValue: unknown
  decode: (value: unknown) => Value
  keyring: DatabaseEncryptionKeyring
}

export function encryptDatabaseValue<Value>(
  options: EncryptDatabaseValueOptions<Value>,
): string {
  try {
    const value = options.decode(options.value)
    const activeKey = options.keyring[0]
    const encrypted = encryptCompactJwe({
      plaintext: serializeDatabaseEncryptionPayload(value),
      protectedHeader: { alg: "dir", enc: "A256GCM", kid: activeKey.kid },
      key: deriveDatabaseEncryptionKey(activeKey.root),
    })
    return encrypted
  } catch {
    throw databaseEncryptionError()
  }
}

export function decryptDatabaseValue<Value>(
  options: DecryptDatabaseValueOptions<Value>,
): DecryptedDatabaseValue<Value> {
  try {
    if (typeof options.storedValue !== "string") throw new Error()
    let selectedKey: DatabaseKeyringEntry | undefined
    const result = decryptCompactJwe({
      compactJwe: options.storedValue,
      resolveKey: (header) => {
        const kid = header.kid
        if (typeof kid !== "string" || !DATABASE_ENCRYPTION_KID_PATTERN.test(kid)) {
          throw new Error()
        }
        selectedKey = options.keyring.find((key) => key.kid === kid)
        if (!selectedKey) throw new Error()
        return deriveDatabaseEncryptionKey(selectedKey.root)
      },
    })
    if (!selectedKey) throw new Error()
    return {
      value: decodeDatabaseEncryptionPayload(result.plaintext, options.decode),
      usedFallbackKey: selectedKey !== options.keyring[0],
    }
  } catch {
    throw databaseEncryptionError()
  }
}

function databaseEncryptionError(): DatabaseEncryptionError {
  return new DatabaseEncryptionError({ message: "Stored database value could not be processed" })
}

function deriveDatabaseEncryptionKey(root: Uint8Array): Uint8Array {
  return new Uint8Array(
    hkdfSync("sha256", root, DATABASE_ENCRYPTION_SALT, DATABASE_ENCRYPTION_INFO, 32),
  )
}

function serializeDatabaseEncryptionPayload(value: unknown): Uint8Array {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error()
  return new TextEncoder().encode(serialized)
}

function decodeDatabaseEncryptionPayload<Value>(
  plaintext: Uint8Array,
  decode: (value: unknown) => Value,
): Value {
  return decode(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)))
}
