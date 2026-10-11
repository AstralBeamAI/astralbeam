import { Schema } from "effect"

import { UuidV7Schema } from "@/lib/schemas"

export const IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const AvatarUploadSchema = Schema.Struct({
  bytes: Schema.Uint8Array.check(
    Schema.makeFilter((bytes) => bytes.length > 0 && bytes.length <= IMAGE_MAX_BYTES),
  ),
})

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
