import { Buffer } from "node:buffer"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

import { Predicate, Result, Schema } from "effect"

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

/** Every rejection reads alike, so a stored value's defect is never described. */
class CompactJweError extends Schema.TaggedError<CompactJweError>()("CompactJweError", {}) {
  override readonly message = "Compact JWE could not be processed"
}

type CompactJweResult<A> = Result.Result<A, CompactJweError>

const compactJweError = Result.fail(new CompactJweError())

// Node's cipher and JSON APIs throw, so this is the one place their failures become Results.
function attemptCompactJwe<A>(operation: () => A | undefined): CompactJweResult<A> {
  try {
    const value = operation()
    return value === undefined ? compactJweError : Result.succeed(value)
  } catch {
    return compactJweError
  }
}

export function encryptCompactJwe(options: {
  plaintext: Uint8Array
  protectedHeader: CompactJweProtectedHeader
  key: Uint8Array
}): CompactJweResult<string> {
  const protectedHeader = serializeProtectedHeader(options.protectedHeader)
  if (protectedHeader === undefined || !isKey(options.key)) return compactJweError
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
}): CompactJweResult<{ plaintext: Uint8Array; protectedHeader: CompactJweProtectedHeader }> {
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
    return compactJweError
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
  const serialized = Result.getOrUndefined(attemptCompactJwe(() => JSON.stringify(header)))
  const roundTripped =
    serialized && Result.getOrUndefined(attemptCompactJwe<unknown>(() => JSON.parse(serialized)))
  if (!serialized || !isSupportedHeader(roundTripped)) return undefined
  const encoded = encodeBase64url(new TextEncoder().encode(serialized))
  return encoded.length <= MAX_PROTECTED_HEADER_LENGTH ? encoded : undefined
}

function parseProtectedHeader(value: string): CompactJweProtectedHeader | undefined {
  if (value.length === 0 || value.length > MAX_PROTECTED_HEADER_LENGTH) return undefined
  const bytes = decodeBase64url(value)
  const header =
    bytes &&
    Result.getOrUndefined(
      attemptCompactJwe<unknown>(() =>
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      ),
    )
  return isSupportedHeader(header) ? header : undefined
}

function isSupportedHeader(value: unknown): value is CompactJweProtectedHeader {
  return (
    Predicate.isObject(value) &&
    !Array.isArray(value) &&
    Predicate.hasProperty(value, "alg") &&
    value.alg === ALGORITHM &&
    Predicate.hasProperty(value, "enc") &&
    value.enc === CONTENT_ENCRYPTION &&
    !("crit" in value) &&
    !("zip" in value)
  )
}

function splitCompactJwe(value: unknown): [string, string, string, string, string] | undefined {
  if (!Predicate.isString(value) || value.length > MAX_COMPACT_JWE_LENGTH) return undefined
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
