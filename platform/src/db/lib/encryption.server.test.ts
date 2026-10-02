import {
  base64url,
  calculateJwkThumbprint,
  compactDecrypt,
  CompactEncrypt,
  decodeProtectedHeader,
} from "jose"
import { Result, Schema } from "effect"
import { describe, expect, test } from "vitest"

import { decryptCompactJwe, encryptCompactJwe } from "@/db/lib/compact-jwe.server"
import { decryptDatabaseValue, encryptDatabaseValue } from "@/db/lib/encryption.server"
import { parseDatabaseEncryptionKeyring } from "@/db/lib/database-credentials.server"

function databaseTestSecret(value: string): string {
  return value.padEnd(32, "-")
}

function loadRawDatabaseTestKeyring(value: unknown) {
  return parseDatabaseEncryptionKeyring(value)
}

function loadDatabaseTestKeyring(value: string) {
  return loadRawDatabaseTestKeyring(value.split(",").map(databaseTestSecret).join(","))
}

function encodeDatabaseTestValue(
  value: unknown,
  keyring = loadDatabaseTestKeyring("active-secret"),
  schema: Schema.Decoder<unknown> = Schema.Unknown,
): string {
  return Result.getOrThrow(encryptDatabaseValue({ value, schema, keyring }))
}

function decryptDatabaseTestString(
  storedValue: string,
  keyring: ReturnType<typeof loadDatabaseTestKeyring>,
) {
  return decryptDatabaseValue({ storedValue, schema: Schema.String, keyring })
}

function rewriteProtectedHeader(
  storedValue: string,
  rewrite: (header: Record<string, unknown>) => Record<string, unknown>,
): string {
  const parts = storedValue.split(".")
  parts[0] = base64url.encode(JSON.stringify(rewrite(decodeProtectedHeader(storedValue))))
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
  ])("rejects missing, short, empty, duplicate, or non-string key lists", (value) => {
    expect(() => loadRawDatabaseTestKeyring(value)).toThrow()
  })

  test("derives stable key IDs and preserves active-first ordering", async () => {
    const first = loadRawDatabaseTestKeyring(
      ` ${databaseTestSecret("first")} , ${databaseTestSecret("second")} `,
    )
    const same = loadDatabaseTestKeyring("first,second")
    const reversed = loadDatabaseTestKeyring("second,first")
    const stored = encodeDatabaseTestValue("value", first, Schema.String)
    const sameStored = encodeDatabaseTestValue("value", same, Schema.String)
    expect(databaseTestKeyId(stored)).toBe(databaseTestKeyId(sameStored))
    await expect(
      calculateJwkThumbprint({
        kty: "oct",
        k: base64url.encode(first[0].root),
      }),
    ).resolves.toBe(databaseTestKeyId(stored))
    expect(decryptDatabaseTestString(stored, reversed)).toEqual(
      Result.succeed({ value: "value", usedFallbackKey: true }),
    )
  })
})

describe("synchronous compact JWE profile", () => {
  test("remains interoperable with jose in both directions", async () => {
    const key = loadDatabaseTestKeyring("interoperability-secret")[0].root
    const plaintext = new TextEncoder().encode("value")
    const protectedHeader = { alg: "dir" as const, enc: "A256GCM" as const, kid: "test" }

    const synchronousJwe = encryptCompactJwe({ plaintext, protectedHeader, key })!
    const joseResult = await compactDecrypt(synchronousJwe, key, {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    })
    expect(new TextDecoder().decode(joseResult.plaintext)).toBe("value")

    const joseJwe = await new CompactEncrypt(plaintext)
      .setProtectedHeader(protectedHeader)
      .encrypt(key)
    const synchronousResult = decryptCompactJwe({ compactJwe: joseJwe, resolveKey: () => key })!
    expect(new TextDecoder().decode(synchronousResult.plaintext)).toBe("value")
  })
})

describe("encrypted database values", () => {
  test("uses fallback keys for old values and the first key for new values", () => {
    const old = loadDatabaseTestKeyring("old")
    const newAndOld = loadDatabaseTestKeyring("new,old")
    const oldStored = encodeDatabaseTestValue("old value", old, Schema.String)
    const fallbackRead = Result.getOrThrow(decryptDatabaseTestString(oldStored, newAndOld))
    expect(fallbackRead).toEqual({ value: "old value", usedFallbackKey: true })

    const newStored = encodeDatabaseTestValue(fallbackRead.value, newAndOld, Schema.String)
    expect(decryptDatabaseTestString(newStored, newAndOld)).toEqual(
      Result.succeed({ value: "old value", usedFallbackKey: false }),
    )
    expect(
      Result.isFailure(decryptDatabaseTestString(oldStored, loadDatabaseTestKeyring("new"))),
    ).toBe(true)
  })

  test("rejects malformed JWE, unknown keys, tampering, and invalid payloads", () => {
    const keyring = loadDatabaseTestKeyring("active-secret")
    const stored = encodeDatabaseTestValue("value", keyring, Schema.String)
    const parts = stored.split(".")
    parts[3] = `${parts[3]!.startsWith("a") ? "b" : "a"}${parts[3]!.slice(1)}`

    const invalidValues = [
      "value",
      rewriteProtectedHeader(stored, (header) => ({ ...header, kid: "A".repeat(43) })),
      rewriteProtectedHeader(stored, (header) => ({ ...header, alg: "A128KW" })),
      parts.join("."),
    ]
    for (const storedValue of invalidValues) {
      expect(Result.isFailure(decryptDatabaseTestString(storedValue, keyring))).toBe(true)
    }

    const invalidPayload = encodeDatabaseTestValue({ invalid: true }, keyring)
    expect(Result.isFailure(decryptDatabaseTestString(invalidPayload, keyring))).toBe(true)
  })
})
