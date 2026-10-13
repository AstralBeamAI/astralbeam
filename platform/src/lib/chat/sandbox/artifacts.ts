import { Result } from "effect"
import { CHAT_ATTACHMENT_MAGIC_BYTES } from "../attachments/constants"

/**
 * Content-sniffed MIME type for an artifact. The signature check, not the extension, decides:
 * raster images and PDFs by magic bytes, valid UTF-8 without NUL as plain text, and everything
 * else as an opaque download. SVG never sniffs as an image, so script-bearing markup can only
 * ever be served as `text/plain`.
 */
export function detectSandboxArtifactMimeType(bytes: Uint8Array): string {
  for (const [mimeType, signature] of Object.entries(CHAT_ATTACHMENT_MAGIC_BYTES)) {
    if (
      signature.every(({ offset, bytes: expected }) =>
        expected.every((value, index) => bytes[offset + index] === value),
      )
    )
      return mimeType
  }
  // NUL distinguishes binary content. The bounded decode checks the head for valid UTF-8.
  const head = bytes.subarray(0, 4096)
  return !head.includes(0) &&
    Result.isSuccess(Result.try(() => new TextDecoder("utf-8", { fatal: true }).decode(head)))
    ? "text/plain"
    : "application/octet-stream"
}

/**
 * The whole `content-disposition` value. Header values are ByteStrings, so the quoted filename
 * carries an ASCII fallback (non-ASCII, controls, quotes, and backslashes become `_`) and the
 * real name travels RFC 5987-encoded in `filename*`, which browsers prefer when present.
 */
export function artifactContentDisposition(disposition: string, path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1)
  const fallback = base.replace(/[^\x20-\x7e]|["\\]/g, "_") || "artifact"
  // encodeURIComponent leaves RFC 5987 attr-char specials like * ' ( ) unescaped; fix them up.
  const encoded = encodeURIComponent(base).replace(
    /[*'()]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
