import { Result } from "effect"
import { CHAT_ATTACHMENT_MAGIC_BYTES } from "../attachments/constants"

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
