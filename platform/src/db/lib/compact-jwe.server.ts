import { Buffer } from "node:buffer"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "dir"
const CONTENT_ENCRYPTION = "A256GCM"
const KEY_LENGTH = 32
const IV_LENGTH = 12
const TAG_LENGTH = 16
const MAX_COMPACT_JWE_LENGTH = 1024 * 1024
const MAX_PROTECTED_HEADER_LENGTH = 8192
const BASE64URL_PATTERN = /^[\w-]*$/

export type CompactJweProtectedHeader = Readonly<Record<string, unknown>> & {
  readonly alg: "dir"
  readonly enc: "A256GCM"
}

// Keep the shared cipher independent of Effect so database migrations fit the standalone binary.
function attemptCompactJwe<A>(operation: () => A | undefined): A | undefined {
  try {
    return operation()
  } catch {
    return undefined
  }
}

export function encryptCompactJwe(options: {
  plaintext: Uint8Array
  protectedHeader: CompactJweProtectedHeader
  key: Uint8Array
}): string | undefined {
  const protectedHeader = serializeProtectedHeader(options.protectedHeader)
  if (protectedHeader === undefined || !isKey(options.key)) return undefined
  return attemptCompactJwe(() => {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv("aes-256-gcm", options.key, iv, { authTagLength: TAG_LENGTH })
    cipher.setAAD(Buffer.from(protectedHeader, "ascii"))
    const ciphertext = Buffer.concat([cipher.update(options.plaintext), cipher.final()])
    const compactJwe = [
      protectedHeader,
      "",
      encodeBase64url(iv),
      encodeBase64url(ciphertext),
      encodeBase64url(cipher.getAuthTag()),
    ].join(".")
    return compactJwe.length <= MAX_COMPACT_JWE_LENGTH ? compactJwe : undefined
  })
}

export function decryptCompactJwe(options: {
  compactJwe: string
  resolveKey: (protectedHeader: CompactJweProtectedHeader) => Uint8Array | undefined
}): { plaintext: Uint8Array; protectedHeader: CompactJweProtectedHeader } | undefined {
  const parts = splitCompactJwe(options.compactJwe)
  const protectedHeader = parts && parseProtectedHeader(parts[0])
  const key = protectedHeader && options.resolveKey(protectedHeader)
  const iv = parts && decodeBase64url(parts[2])
  const ciphertext = parts && decodeBase64url(parts[3])
  const authenticationTag = parts && decodeBase64url(parts[4])
  if (
    !parts ||
    !protectedHeader ||
    !key ||
    !isKey(key) ||
    iv?.byteLength !== IV_LENGTH ||
    !ciphertext ||
    authenticationTag?.byteLength !== TAG_LENGTH
  ) {
    return undefined
  }
  return attemptCompactJwe(() => {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH })
    decipher.setAAD(Buffer.from(parts[0], "ascii"))
    decipher.setAuthTag(authenticationTag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return { plaintext: Uint8Array.from(plaintext), protectedHeader }
  })
}

function serializeProtectedHeader(header: CompactJweProtectedHeader): string | undefined {
  if (!isSupportedHeader(header)) return undefined
  const serialized = attemptCompactJwe(() => JSON.stringify(header))
  const roundTripped = serialized && attemptCompactJwe<unknown>(() => JSON.parse(serialized))
  if (!serialized || !isSupportedHeader(roundTripped)) return undefined
  const encoded = encodeBase64url(new TextEncoder().encode(serialized))
  return encoded.length <= MAX_PROTECTED_HEADER_LENGTH ? encoded : undefined
}

function parseProtectedHeader(value: string): CompactJweProtectedHeader | undefined {
  if (value.length === 0 || value.length > MAX_PROTECTED_HEADER_LENGTH) return undefined
  const bytes = decodeBase64url(value)
  const header =
    bytes &&
    attemptCompactJwe<unknown>(() =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    )
  return isSupportedHeader(header) ? header : undefined
}

function isSupportedHeader(value: unknown): value is CompactJweProtectedHeader {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "alg" in value &&
    value.alg === ALGORITHM &&
    "enc" in value &&
    value.enc === CONTENT_ENCRYPTION &&
    !("crit" in value) &&
    !("zip" in value)
  )
}

function splitCompactJwe(value: unknown): [string, string, string, string, string] | undefined {
  if (typeof value !== "string" || value.length > MAX_COMPACT_JWE_LENGTH) return undefined
  const parts = value.split(".")
  return parts.length === 5 && parts[1] === ""
    ? (parts as [string, string, string, string, string])
    : undefined
}

function isKey(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength === KEY_LENGTH
}

function encodeBase64url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url")
}

function decodeBase64url(value: string): Uint8Array | undefined {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return undefined
  const decoded = Buffer.from(value, "base64url")
  return decoded.toString("base64url") === value ? Uint8Array.from(decoded) : undefined
}
