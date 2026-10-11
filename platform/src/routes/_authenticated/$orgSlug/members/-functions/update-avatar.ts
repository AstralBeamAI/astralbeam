import { createServerFn } from "@tanstack/react-start"
import { and, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { member } from "@/db/schema/organizations"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { SlugSchema } from "@/lib/organizations/slug"
import { consumeImageUpload, retireImage } from "@/lib/organizations/images.server"
import { avatarFileUrl } from "@/lib/organizations/images"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { InvalidImage } from "@/lib/storage/errors"
import { IMAGE_MAX_BYTES } from "@/lib/storage/image-limits"
import { verifiedImage } from "@/lib/storage/image-source.server"
import { StoredFiles } from "@/lib/storage/stored-files.server"

const AvatarUploadSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  bytes: Schema.NullOr(
    Schema.Uint8Array.check(
      Schema.makeFilter((bytes) => bytes.length > 0 && bytes.length <= IMAGE_MAX_BYTES),
    ),
  ),
})

export const updateMemberAvatar = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware()])
  .validator(toValidationSchema(AvatarUploadSchema))
  .handler(({ data, context, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const db = yield* Database
        const files = yield* StoredFiles
        const owner = and(
          eq(member.organizationId, context.organizationId),
          eq(member.id, context.memberId),
        )
        const [current] = yield* db
          .select({ userId: member.userId, avatarFileId: member.avatarFileId })
          .from(member)
          .where(owner)
          .pipe(mapDatabaseErrors())
        if (!current) return yield* new InvalidImage()
        let avatarFileId: string | null = null
        if (data.bytes) {
          yield* consumeImageUpload({ userId: current.userId })
          const image = yield* verifiedImage(data.bytes)
          avatarFileId = (yield* files.upload({ ...image, organizationId: context.organizationId }))
            .id
        }
        // The upload happens outside SQL. Recheck membership when attaching the new file.
        const [updated] = yield* db
          .update(member)
          .set({ avatarFileId })
          .where(owner)
          .returning({ id: member.id })
          .pipe(mapDatabaseErrors())
        if (!updated) return yield* new InvalidImage()
        yield* retireImage({ organizationId: context.organizationId, fileId: current.avatarFileId })
        return avatarFileId ? avatarFileUrl(context.organizationId, avatarFileId) : null
      }).pipe(
        Effect.catchTag(
          ["InvalidImage", "StorageUnavailable", "StorageObjectMissing", "ImageUploadRateLimited"],
          exposeError,
        ),
      ),
      serverFnMeta.name,
    ),
  )
