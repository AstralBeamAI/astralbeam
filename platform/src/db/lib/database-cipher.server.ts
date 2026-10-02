import { hkdfSync } from "node:crypto"

import { decryptCompactJwe, encryptCompactJwe } from "./compact-jwe.server.ts"
import type {
  DatabaseEncryptionKeyring,
  DatabaseKeyringEntry,
} from "./database-credentials.server.ts"

const DATABASE_ENCRYPTION_SALT = new TextEncoder().encode("database-encryption:hkdf-sha256:v1")
const DATABASE_ENCRYPTION_INFO = new TextEncoder().encode("database-encryption:a256gcm:v1")
const DATABASE_ENCRYPTION_KID_PATTERN = /^[\w-]{43}$/

export function encryptDatabaseJson(options: {
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

export function decryptDatabaseJson(options: {
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
