import { Effect, Schema } from "effect"

import { InvalidImage } from "./errors"

export const IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const AvatarUploadSchema = Schema.Struct({
  bytes: Schema.Uint8Array.check(
    Schema.makeFilter((bytes) => bytes.length > 0 && bytes.length <= IMAGE_MAX_BYTES),
  ),
})

function imageContentType(bytes: Uint8Array): string | undefined {
  if (bytes.length < 12 || bytes.length > IMAGE_MAX_BYTES) return undefined
  if (
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) &&
    bytes.length >= 45 &&
    new TextDecoder().decode(bytes.slice(-8, -4)) === "IEND"
  )
    return "image/png"
  if (
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217
  )
    return "image/jpeg"
  const prefix = new TextDecoder().decode(bytes.slice(0, 12))
  if ((prefix.startsWith("GIF87a") || prefix.startsWith("GIF89a")) && bytes.at(-1) === 59)
    return "image/gif"
  if (
    prefix.startsWith("RIFF") &&
    prefix.endsWith("WEBP") &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) ===
      bytes.length - 8
  )
    return "image/webp"
  return undefined
}

export const verifiedImage = Effect.fn("verifiedImage")(function* (bytes: Uint8Array) {
  const contentType = imageContentType(bytes)
  if (!contentType) return yield* new InvalidImage()
  return { bytes, contentType }
})

export const fileSha256 = Effect.fn("fileSha256")((bytes: Uint8Array) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  }),
)

export const embeddedImage = Effect.fn("embeddedImage")((source: string) =>
  Effect.try({
    try: () => {
      const match = /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source)
      if (!match || match[1]!.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4) throw new InvalidImage()
      return Uint8Array.from(atob(match[1]!), (char) => char.charCodeAt(0))
    },
    catch: () => new InvalidImage(),
  }).pipe(Effect.flatMap(verifiedImage)),
)

export function avatarFileUrl(id: string): string {
  return `/api/files/avatars/${id}`
}
export function logoFileUrl(organizationId: string, id: string): string {
  return `/api/files/organizations/${organizationId}/logos/${id}`
}

export function avatarFileId(url: string | null | undefined): string | undefined {
  return url ? /^\/api\/files\/avatars\/([0-9a-f-]{36})$/.exec(url)?.[1] : undefined
}
