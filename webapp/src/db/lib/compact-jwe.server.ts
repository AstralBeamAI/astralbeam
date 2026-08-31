import { Buffer } from "node:buffer"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "dir"
const CONTENT_ENCRYPTION = "A256GCM"
const KEY_LENGTH = 32
const IV_LENGTH = 12
const TAG_LENGTH = 16
const MAX_COMPACT_JWE_LENGTH = 1024 * 1024
const MAX_PROTECTED_HEADER_LENGTH = 8192
const BASE64URL_PATTERN = /^[\w-]*$/i

export type CompactJweProtectedHeader = Readonly<Record<string, unknown>> & {
  readonly alg: "dir"
  readonly enc: "A256GCM"
}

class CompactJweError extends Error {
  override readonly name = "CompactJweError"

  constructor() {
    super("Compact JWE could not be processed")
  }
}

export function encryptCompactJwe(options: {
  plaintext: Uint8Array
  protectedHeader: CompactJweProtectedHeader
  key: Uint8Array
}): string {
  try {
    assertKey(options.key)
    const protectedHeader = serializeProtectedHeader(options.protectedHeader)
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv("aes-256-gcm", options.key, iv, {
      authTagLength: TAG_LENGTH,
    })
    cipher.setAAD(Buffer.from(protectedHeader, "ascii"))
    const ciphertext = Buffer.concat([
      cipher.update(options.plaintext),
      cipher.final(),
    ])
    const authenticationTag = cipher.getAuthTag()
    const compactJwe = [
      protectedHeader,
      "",
      encodeBase64url(iv),
      encodeBase64url(ciphertext),
      encodeBase64url(authenticationTag),
    ].join(".")
    if (compactJwe.length > MAX_COMPACT_JWE_LENGTH) throw new Error()
    return compactJwe
  } catch {
    throw new CompactJweError()
  }
}

export function decryptCompactJwe(options: {
  compactJwe: string
  resolveKey: (protectedHeader: CompactJweProtectedHeader) => Uint8Array
}): {
  plaintext: Uint8Array
  protectedHeader: CompactJweProtectedHeader
} {
  try {
    const parts = splitCompactJwe(options.compactJwe)
    const protectedHeader = parseProtectedHeader(parts[0])
    const key = options.resolveKey(protectedHeader)
    assertKey(key)
    const iv = decodeBase64url(parts[2])
    const ciphertext = decodeBase64url(parts[3])
    const authenticationTag = decodeBase64url(parts[4])
    if (iv.byteLength !== IV_LENGTH || authenticationTag.byteLength !== TAG_LENGTH) {
      throw new Error()
    }

    const decipher = createDecipheriv("aes-256-gcm", key, iv, {
      authTagLength: TAG_LENGTH,
    })
    decipher.setAAD(Buffer.from(parts[0], "ascii"))
    decipher.setAuthTag(authenticationTag)
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])
    return { plaintext: Uint8Array.from(plaintext), protectedHeader }
  } catch {
    throw new CompactJweError()
  }
}

function serializeProtectedHeader(header: CompactJweProtectedHeader): string {
  assertSupportedHeader(header)
  const serialized = JSON.stringify(header)
  if (serialized === undefined) throw new Error()
  const serializedHeader: unknown = JSON.parse(serialized)
  assertSupportedHeader(serializedHeader)
  const encoded = encodeBase64url(new TextEncoder().encode(serialized))
  if (encoded.length > MAX_PROTECTED_HEADER_LENGTH) throw new Error()
  return encoded
}

function parseProtectedHeader(value: string): CompactJweProtectedHeader {
  if (value.length === 0 || value.length > MAX_PROTECTED_HEADER_LENGTH) throw new Error()
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(value))
  const header: unknown = JSON.parse(decoded)
  assertSupportedHeader(header)
  return header
}

function assertSupportedHeader(value: unknown): asserts value is CompactJweProtectedHeader {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    !("alg" in value) || value.alg !== ALGORITHM ||
    !("enc" in value) || value.enc !== CONTENT_ENCRYPTION ||
    "crit" in value || "zip" in value
  ) throw new Error()
}

function splitCompactJwe(value: string): [string, string, string, string, string] {
  if (typeof value !== "string" || value.length > MAX_COMPACT_JWE_LENGTH) throw new Error()
  const parts = value.split(".")
  if (parts.length !== 5 || parts[1] !== "") throw new Error()
  return parts as [string, string, string, string, string]
}

function assertKey(value: Uint8Array): void {
  if (!(value instanceof Uint8Array) || value.byteLength !== KEY_LENGTH) throw new Error()
}

function encodeBase64url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url")
}

function decodeBase64url(value: string): Uint8Array {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) throw new Error()
  const decoded = Buffer.from(value, "base64url")
  if (decoded.toString("base64url") !== value) throw new Error()
  return Uint8Array.from(decoded)
}
