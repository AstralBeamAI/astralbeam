import { Effect, Schema } from "effect"

import { UuidV7Schema } from "@/lib/schemas"

export const IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const AvatarUploadSchema = Schema.Struct({
  bytes: Schema.Uint8Array.check(
    Schema.makeFilter((bytes) => bytes.length > 0 && bytes.length <= IMAGE_MAX_BYTES),
  ),
})

export const fileSha256 = Effect.fn("fileSha256")((bytes: Uint8Array) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  }),
)

export function avatarFileUrl(id: string): string {
  return `/api/files/avatars/${id}`
}
export function logoFileUrl(organizationId: string, id: string): string {
  return `/api/files/organizations/${organizationId}/logos/${id}`
}

export function avatarFileId(url: string | null | undefined): string | undefined {
  const id = url ? /^\/api\/files\/avatars\/([^/]+)$/.exec(url)?.[1] : undefined
  return Schema.is(UuidV7Schema)(id) ? id : undefined
}
