import { base64url, jwtVerify, SignJWT } from "jose"

import { getActiveDatabaseEncryptionRoot } from "@/db/lib/database-credentials.server"
import {
  CHAT_ARTIFACT_TICKET_AUDIENCE,
  CHAT_ARTIFACT_TICKET_LIFETIME_SECONDS,
  CHAT_ARTIFACT_TICKET_TYPE,
  CHAT_ATTACHMENT_MAGIC_BYTES,
} from "./constants.server"

/**
 * Sandbox artifact tickets: a short-lived signed capability to download exactly the published
 * bytes of one file. The signing key is HKDF-derived from the deployment's encryption root with
 * its own info label: deployment-wide, so any replica (and a restarted process) can verify a
 * ticket another minted against a vendor sandbox that is still alive, while staying
 * domain-separated from every other use of the root and independent of the stored API-key
 * digest. Rotating the first DATABASE_ENCRYPTION_KEY entry invalidates live tickets, which at a
 * fifteen-minute lifetime is acceptable.
 */
let artifactTicketKeyPromise: Promise<Uint8Array> | undefined

function artifactTicketKey(): Promise<Uint8Array> {
  return artifactTicketKeyPromise ??= deriveArtifactTicketKey()
}

async function deriveArtifactTicketKey(): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    getActiveDatabaseEncryptionRoot() as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode("astralbeam sandbox artifact ticket v1"),
    },
    material,
    256,
  )
  return new Uint8Array(bits)
}

/** Digest binding a ticket to the exact published bytes, so a same-type overwrite is refused. */
export async function artifactContentDigest(bytes: Uint8Array): Promise<string> {
  return base64url.encode(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)),
  )
}

export interface SandboxArtifactTicket {
  /** Organization and tenant user the publishing run was authenticated as, for auditability. */
  readonly organizationId: string
  readonly tenantUserId: string
  /** Enough to reconnect: the stored provider configuration and the vendor's sandbox id. */
  readonly sandboxProviderId: string
  readonly providerSandboxId: string
  /** Absolute path inside the sandbox, already containment-checked at publish time. */
  readonly path: string
  readonly mimeType: string
  readonly size: number
  /** Unpadded base64url SHA-256 of the published bytes; the capability covers these bytes only. */
  readonly sha256: string
}

export async function mintSandboxArtifactTicket(
  ticket: SandboxArtifactTicket,
): Promise<string> {
  return await new SignJWT({ ...ticket })
    .setProtectedHeader({ alg: "HS256", typ: CHAT_ARTIFACT_TICKET_TYPE })
    .setAudience(CHAT_ARTIFACT_TICKET_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${CHAT_ARTIFACT_TICKET_LIFETIME_SECONDS}s`)
    .sign(await artifactTicketKey())
}

/** Returns the ticket's claims, or undefined for anything invalid, expired, or malformed. */
export async function verifySandboxArtifactTicket(
  token: string,
): Promise<SandboxArtifactTicket | undefined> {
  try {
    const { payload } = await jwtVerify(token, await artifactTicketKey(), {
      audience: CHAT_ARTIFACT_TICKET_AUDIENCE,
      typ: CHAT_ARTIFACT_TICKET_TYPE,
    })
    const {
      organizationId,
      tenantUserId,
      sandboxProviderId,
      providerSandboxId,
      path,
      mimeType,
      sha256,
    } = payload as Partial<SandboxArtifactTicket>
    const size = payload["size"]
    if (
      typeof organizationId !== "string" || typeof tenantUserId !== "string" ||
      typeof sandboxProviderId !== "string" || typeof providerSandboxId !== "string" ||
      typeof path !== "string" || typeof mimeType !== "string" || typeof size !== "number" ||
      typeof sha256 !== "string"
    ) {
      return undefined
    }
    return {
      organizationId,
      tenantUserId,
      sandboxProviderId,
      providerSandboxId,
      path,
      mimeType,
      size,
      sha256,
    }
  } catch {
    return undefined
  }
}

function matchesMagicBytes(
  bytes: Uint8Array,
  signature: ReadonlyArray<{ offset: number; bytes: readonly number[] }>,
): boolean {
  return signature.every(({ offset, bytes: expected }) =>
    expected.every((value, index) => bytes[offset + index] === value)
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
  if (head.includes(0)) return false
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head)
    return true
  } catch {
    return false
  }
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
    ascii += code < 0x20 || code > 0x7e || base[index] === '"' || base[index] === "\\"
      ? "_"
      : base[index]
  }
  const fallback = ascii.length > 0 ? ascii : "artifact"
  // encodeURIComponent leaves RFC 5987 attr-char specials like * ' ( ) unescaped; fix them up.
  const encoded = encodeURIComponent(base).replace(
    /[*'()]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
