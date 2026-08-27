import {
  base64url,
  calculateJwkThumbprint,
  compactDecrypt,
  CompactEncrypt,
  decodeProtectedHeader,
} from "jose"
import { describe, expect, test } from "vitest"

import { decryptCompactJwe, encryptCompactJwe } from "@/db/lib/compact-jwe.server"
import { decryptDatabaseValue, encryptDatabaseValue } from "@/db/lib/encryption.server"
import { parseDatabaseEncryptionKeyring } from "@/db/lib/database-credentials.server"

function decodeDatabaseTestString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected string")
  return value
}

function databaseTestSecret(value: string): string {
  return value.padEnd(32, "-")
}

function loadRawDatabaseTestKeyring(value: unknown) {
  return parseDatabaseEncryptionKeyring(value)
}

function loadDatabaseTestKeyring(value: string) {
  return loadRawDatabaseTestKeyring(
    value.split(",").map(databaseTestSecret).join(","),
  )
}

function encodeDatabaseTestValue(
  value: unknown,
  keyring = loadDatabaseTestKeyring("active-secret"),
  decode: (value: unknown) => unknown = (input) => input,
): string {
  return encryptDatabaseValue({
    value,
    decode,
    keyring,
  })
}

function rewriteProtectedHeader(
  storedValue: string,
  rewrite: (header: Record<string, unknown>) => Record<string, unknown>,
): string {
  const parts = storedValue.split(".")
  const header = JSON.parse(new TextDecoder().decode(base64url.decode(parts[0]!)))
  parts[0] = base64url.encode(JSON.stringify(rewrite(header)))
  return parts.join(".")
}

function databaseTestKeyId(storedValue: string): string | undefined {
  return decodeProtectedHeader(storedValue).kid
}

describe("database encryption keyring", () => {
  const one = databaseTestSecret("one")
  const two = databaseTestSecret("two")
  test.each([
    undefined,
    "",
    "   ",
    "short",
    "x".repeat(1_025),
    `${one},,${two}`,
    `,${one}`,
    `${one},`,
    `${one},${one}`,
    42,
  ])(
    "rejects missing, short, empty, duplicate, or non-string key lists",
    (value) => {
      expect(() => loadRawDatabaseTestKeyring(value)).toThrow()
    },
  )

  test("derives stable key IDs and preserves active-first ordering", async () => {
    const first = loadRawDatabaseTestKeyring(
      ` ${databaseTestSecret("first")} , ${databaseTestSecret("second")} `,
    )
    const same = loadDatabaseTestKeyring("first,second")
    const reversed = loadDatabaseTestKeyring("second,first")
    const stored = encodeDatabaseTestValue("value", first, decodeDatabaseTestString)
    const sameStored = encodeDatabaseTestValue("value", same, decodeDatabaseTestString)
    expect(databaseTestKeyId(stored)).toBe(databaseTestKeyId(sameStored))
    await expect(calculateJwkThumbprint({
      kty: "oct",
      k: base64url.encode(first[0].root),
    })).resolves.toBe(databaseTestKeyId(stored))
    expect(decryptDatabaseValue({
      storedValue: stored,
      decode: decodeDatabaseTestString,
      keyring: reversed,
    })).toEqual({ value: "value", usedFallbackKey: true })
  })
})

describe("synchronous compact JWE profile", () => {
  test("remains interoperable with jose in both directions", async () => {
    const key = loadDatabaseTestKeyring("interoperability-secret")[0].root
    const plaintext = new TextEncoder().encode("value")
    const protectedHeader = { alg: "dir" as const, enc: "A256GCM" as const, kid: "test" }

    const synchronousJwe = encryptCompactJwe({ plaintext, protectedHeader, key })
    const joseResult = await compactDecrypt(synchronousJwe, key, {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    })
    expect(new TextDecoder().decode(joseResult.plaintext)).toBe("value")

    const joseJwe = await new CompactEncrypt(plaintext)
      .setProtectedHeader(protectedHeader)
      .encrypt(key)
    const synchronousResult = decryptCompactJwe({
      compactJwe: joseJwe,
      resolveKey: () => key,
    })
    expect(new TextDecoder().decode(synchronousResult.plaintext)).toBe("value")
  })
})

describe("encrypted database values", () => {
  test("uses fallback keys for old values and the first key for new values", () => {
    const old = loadDatabaseTestKeyring("old")
    const newAndOld = loadDatabaseTestKeyring("new,old")
    const oldStored = encodeDatabaseTestValue("old value", old, decodeDatabaseTestString)
    const fallbackRead = decryptDatabaseValue({
      storedValue: oldStored,
      decode: decodeDatabaseTestString,
      keyring: newAndOld,
    })
    expect(fallbackRead).toEqual({ value: "old value", usedFallbackKey: true })

    const newStored = encodeDatabaseTestValue(
      fallbackRead.value,
      newAndOld,
      decodeDatabaseTestString,
    )
    expect(decryptDatabaseValue({
      storedValue: newStored,
      decode: decodeDatabaseTestString,
      keyring: newAndOld,
    })).toEqual({ value: "old value", usedFallbackKey: false })
    expect(() =>
      decryptDatabaseValue({
        storedValue: oldStored,
        decode: decodeDatabaseTestString,
        keyring: loadDatabaseTestKeyring("new"),
      })
    ).toThrow()
  })

  test("rejects malformed JWE, unknown keys, tampering, and invalid payloads", () => {
    const keyring = loadDatabaseTestKeyring("active-secret")
    const stored = encodeDatabaseTestValue("value", keyring, decodeDatabaseTestString)
    const parts = stored.split(".")
    parts[3] = `${parts[3]!.startsWith("a") ? "b" : "a"}${parts[3]!.slice(1)}`

    const invalidValues = [
      "value",
      rewriteProtectedHeader(stored, (header) => ({ ...header, kid: "A".repeat(43) })),
      rewriteProtectedHeader(stored, (header) => ({ ...header, alg: "A128KW" })),
      parts.join("."),
    ]
    for (const storedValue of invalidValues) {
      expect(() =>
        decryptDatabaseValue({
          storedValue,
          decode: decodeDatabaseTestString,
          keyring,
        })
      ).toThrow()
    }

    const invalidPayload = encodeDatabaseTestValue({ invalid: true }, keyring)
    expect(() =>
      decryptDatabaseValue({
        storedValue: invalidPayload,
        decode: decodeDatabaseTestString,
        keyring,
      })
    ).toThrow()
  })
})
