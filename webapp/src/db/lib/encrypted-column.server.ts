import { customType } from "drizzle-orm/pg-core"

import { decryptDatabaseValue, encryptDatabaseValue } from "./encryption.server.ts"
import {
  type DatabaseEncryptionKeyring,
  getDatabaseEncryptionKeyring,
} from "./database-credentials.server.ts"

type EncryptedJsonOptions<Value> = {
  decode: (value: unknown) => Value
  keyring?: DatabaseEncryptionKeyring
}

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
