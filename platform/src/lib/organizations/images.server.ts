import { and, eq, sql } from "drizzle-orm"
import { Effect } from "effect"

import { Database } from "@/db/database"
import { DatabaseRateLimiter } from "@/db/lib/rate-limiter"
import { ImageUploadRateLimited } from "@/lib/storage/errors"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { fileObject } from "@/db/schema/files"
import { member, organization } from "@/db/schema/organizations"

export const retireImage = Effect.fn("retireImage")(function* ({
  organizationId,
  fileId,
}: {
  organizationId: string
  fileId: string | null
}) {
  if (!fileId) return
  const db = yield* Database
  // A logo can reuse an existing image. Retire it only after its last profile reference is gone.
  // Cleanup is best effort after attachment changes commit. Outages may leave unreachable files.
  yield* db
    .update(fileObject)
    .set({ status: "purging" })
    .where(
      and(
        eq(fileObject.organizationId, organizationId),
        eq(fileObject.id, fileId),
        sql`not exists (select 1 from ${member} where ${member.organizationId} = ${organizationId} and ${member.avatarFileId} = ${fileId})`,
        sql`not exists (select 1 from ${organization} where ${organization.id} = ${organizationId} and ${organization.logoFileId} = ${fileId})`,
      ),
    )
    .pipe(
      mapDatabaseErrors(),
      Effect.catchCause(() => Effect.logWarning("Could not retire an unused image")),
    )
})

export const consumeImageUpload = Effect.fn("consumeImageUpload")(function* ({
  userId,
}: {
  userId: string
}) {
  const limiter = yield* DatabaseRateLimiter
  yield* limiter
    .consume({ key: `profile-upload:${userId}`, limit: 10, window: "1 hour" })
    .pipe(
      Effect.catch((error) =>
        error.reason._tag === "RateLimitExceeded"
          ? Effect.fail(new ImageUploadRateLimited())
          : Effect.die(error),
      ),
    )
})
