import { Effect, Result, Schema } from "effect"
import { base64url, jwtVerify, SignJWT } from "jose"

import { getActiveDatabaseEncryptionRoot } from "@/db/lib/database-credentials.server"
import { APP_HANDLE } from "@/lib/constants"
import {
  CHAT_ARTIFACT_TICKET_AUDIENCE,
  CHAT_ARTIFACT_TICKET_LIFETIME_SECONDS,
  CHAT_ARTIFACT_TICKET_TYPE,
  CHAT_ATTACHMENT_MAGIC_BYTES,
} from "./constants.server"
import { ChatArtifactUnavailable } from "./errors.ts"

/**
 * Sandbox artifact tickets: a short-lived signed capability to download exactly the published
 * bytes of one file. The signing key is HKDF-derived from the deployment's encryption root with
 * its own info label: deployment-wide, so any replica (and a restarted process) can verify a
 * ticket another minted against a vendor sandbox that is still alive, while staying
 * domain-separated from every other use of the root and independent of the stored API-key
 * digest. Rotating the first DATABASE_ENCRYPTION_KEY entry or changing APP_HANDLE invalidates
 * live tickets, which at a fifteen-minute lifetime is acceptable.
 */
export const deriveArtifactTicketKey = Effect.gen(function* () {
  const material = yield* Effect.promise(() =>
    crypto.subtle.importKey(
      "raw",
      getActiveDatabaseEncryptionRoot() as BufferSource,
      "HKDF",
      false,
      ["deriveBits"],
    ),
  )
  const bits = yield* Effect.promise(() =>
    crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(0),
        info: new TextEncoder().encode(`${APP_HANDLE} sandbox artifact ticket v1`),
      },
      material,
      256,
    ),
  )
  return new Uint8Array(bits)
})

/** Digest binding a ticket to the exact published bytes, so a same-type overwrite is refused. */
export function artifactContentDigest(bytes: Uint8Array) {
  return Effect.promise(() => crypto.subtle.digest("SHA-256", bytes as BufferSource)).pipe(
    Effect.map((digest) => base64url.encode(new Uint8Array(digest))),
  )
}

const SandboxArtifactTicketSchema = Schema.Struct({
  /** Full tenant-user scope the publishing run was authenticated as, for auditability. */
  organizationId: Schema.String,
  tenantId: Schema.String,
  tenantUserId: Schema.String,
  /** Enough to reconnect: the stored provider configuration and the vendor's sandbox id. */
  sandboxProviderId: Schema.String,
  providerSandboxId: Schema.String,
  /** Absolute path inside the sandbox, already containment-checked at publish time. */
  path: Schema.String,
  mimeType: Schema.String,
  size: Schema.Number,
  /** Unpadded base64url SHA-256 of the published bytes; the capability covers these bytes only. */
  sha256: Schema.String,
})
export type SandboxArtifactTicket = typeof SandboxArtifactTicketSchema.Type
const decodeSandboxArtifactTicket = Schema.decodeUnknownEffect(SandboxArtifactTicketSchema)

export function mintSandboxArtifactTicket(key: Uint8Array, ticket: SandboxArtifactTicket) {
  return Effect.promise(() =>
    new SignJWT({ ...ticket })
      .setProtectedHeader({ alg: "HS256", typ: CHAT_ARTIFACT_TICKET_TYPE })
      .setAudience(CHAT_ARTIFACT_TICKET_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${CHAT_ARTIFACT_TICKET_LIFETIME_SECONDS}s`)
      .sign(key),
  )
}

/** The ticket's claims, failing alike for anything invalid, expired, or malformed. */
export function verifySandboxArtifactTicket(key: Uint8Array, token: string) {
  return Effect.tryPromise(() =>
    jwtVerify(token, key, {
      audience: CHAT_ARTIFACT_TICKET_AUDIENCE,
      typ: CHAT_ARTIFACT_TICKET_TYPE,
    }),
  ).pipe(
    Effect.flatMap(({ payload }) => decodeSandboxArtifactTicket(payload)),
    Effect.mapError(() => new ChatArtifactUnavailable({ reason: "Expired" })),
  )
}

function matchesMagicBytes(
  bytes: Uint8Array,
  signature: ReadonlyArray<{ offset: number; bytes: readonly number[] }>,
): boolean {
  return signature.every(({ offset, bytes: expected }) =>
    expected.every((value, index) => bytes[offset + index] === value),
  )
}

/**
 * Content-sniffed MIME type for an artifact. The signature check, not the extension, decides:
 * raster images and PDFs by magic bytes, valid UTF-8 without NUL as plain text, and everything
 * else as an opaque download. SVG never sniffs as an image, so script-bearing markup can only
 * ever be served as `text/plain`.
 */
export function detectSandboxArtifactMimeType(bytes: Uint8Array): string {
  for (const [mimeType, signature] of Object.entries(CHAT_ATTACHMENT_MAGIC_BYTES)) {
    if (matchesMagicBytes(bytes, signature)) return mimeType
  }
  if (isPlainText(bytes)) return "text/plain"
  return "application/octet-stream"
}

/** An artifact renders inline only as a sniffed raster image; everything else downloads. */
export function isInlineArtifactMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/")
}

function isPlainText(bytes: Uint8Array): boolean {
  // NUL is the practical text/binary discriminator; a full decode then proves valid UTF-8.
  const head = bytes.subarray(0, 4096)
  return (
    !head.includes(0) &&
    Result.isSuccess(Result.try(() => new TextDecoder("utf-8", { fatal: true }).decode(head)))
  )
}

/**
 * The whole `content-disposition` value. Header values are ByteStrings, so the quoted filename
 * carries an ASCII fallback (non-ASCII, controls, quotes, and backslashes become `_`) and the
 * real name travels RFC 5987-encoded in `filename*`, which browsers prefer when present.
 */
export function artifactContentDisposition(disposition: string, path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1)
  let ascii = ""
  for (let index = 0; index < base.length; index += 1) {
    const code = base.charCodeAt(index)
    ascii +=
      code < 0x20 || code > 0x7e || base[index] === '"' || base[index] === "\\" ? "_" : base[index]
  }
  const fallback = ascii.length > 0 ? ascii : "artifact"
  // encodeURIComponent leaves RFC 5987 attr-char specials like * ' ( ) unescaped; fix them up.
  const encoded = encodeURIComponent(base).replace(
    /[*'()]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
