import { jwtVerify, SignJWT } from "jose"

import {
  CHAT_ARTIFACT_TICKET_AUDIENCE,
  CHAT_ARTIFACT_TICKET_LIFETIME_SECONDS,
  CHAT_ARTIFACT_TICKET_TYPE,
  CHAT_ATTACHMENT_MAGIC_BYTES,
} from "./constants.server"

/**
 * Sandbox artifact tickets: a short-lived signed capability to download one published file. The
 * signing key is process-local random on purpose — the sandbox leases the tickets point at are
 * process-local too, so a ticket that outlives the process could never be served anyway, and a
 * random key means database access alone cannot forge one (unlike the chat JWT's stored digest).
 */
const ARTIFACT_TICKET_KEY = crypto.getRandomValues(new Uint8Array(32))

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
}

export async function mintSandboxArtifactTicket(
  ticket: SandboxArtifactTicket,
): Promise<string> {
  return await new SignJWT({ ...ticket })
    .setProtectedHeader({ alg: "HS256", typ: CHAT_ARTIFACT_TICKET_TYPE })
    .setAudience(CHAT_ARTIFACT_TICKET_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${CHAT_ARTIFACT_TICKET_LIFETIME_SECONDS}s`)
    .sign(ARTIFACT_TICKET_KEY)
}

/** Returns the ticket's claims, or undefined for anything invalid, expired, or malformed. */
export async function verifySandboxArtifactTicket(
  token: string,
): Promise<SandboxArtifactTicket | undefined> {
  try {
    const { payload } = await jwtVerify(token, ARTIFACT_TICKET_KEY, {
      audience: CHAT_ARTIFACT_TICKET_AUDIENCE,
      typ: CHAT_ARTIFACT_TICKET_TYPE,
    })
    const { organizationId, tenantUserId, sandboxProviderId, providerSandboxId, path, mimeType } =
      payload as Partial<SandboxArtifactTicket>
    const size = payload["size"]
    if (
      typeof organizationId !== "string" || typeof tenantUserId !== "string" ||
      typeof sandboxProviderId !== "string" || typeof providerSandboxId !== "string" ||
      typeof path !== "string" || typeof mimeType !== "string" || typeof size !== "number"
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

/** A filename safe for a `content-disposition` header: basename only, control and quote free. */
export function artifactDispositionFilename(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1)
  // Built per UTF-16 unit rather than with a regex: control characters in a pattern trip lint
  // rules, and surrogate halves pass through unchanged so emoji filenames survive.
  let cleaned = ""
  for (let index = 0; index < base.length; index += 1) {
    const code = base.charCodeAt(index)
    cleaned += code < 0x20 || base[index] === '"' || base[index] === "\\" ? "_" : base[index]
  }
  return cleaned.length > 0 ? cleaned : "artifact"
}
