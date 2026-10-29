import { and, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Activity, Workflow } from "effect/workflow"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { member } from "@/db/schema/organizations"
import { retireImage } from "@/lib/organizations/images.server"
import { UuidV7Schema } from "@/lib/schemas"
import { ImageSources } from "@/lib/storage/image-source.server"
import { StoredFiles } from "@/lib/storage/stored-files.server"

// Each trigger imports a validated URL across the user's memberships, replacing existing avatars.
const profileImageImport = Workflow.make("ProfileImageImport/v3", {
  payload: { userId: UuidV7Schema, imageUrl: Schema.String },
  // A fresh execution lets a later login refresh the same source URL.
  idempotencyKey: () => crypto.randomUUID(),
})

export const profileImageImportWorkflowLayer = profileImageImport.toLayer((input) =>
  Activity.make({
    name: "ImportImage",
    execute: Effect.gen(function* () {
      const db = yield* Database
      const files = yield* StoredFiles
      const sources = yield* ImageSources
      const memberships = yield* db
        .select({
          id: member.id,
          organizationId: member.organizationId,
          avatarFileId: member.avatarFileId,
        })
        .from(member)
        .where(eq(member.userId, input.userId))
        .pipe(mapDatabaseErrors())
      if (!memberships.length) return
      const image = yield* sources.fetch({ source: input.imageUrl })
      for (const membership of memberships) {
        const file = yield* files.upload({ ...image, organizationId: membership.organizationId })
        yield* db
          .update(member)
          .set({ avatarFileId: file.id })
          .where(
            and(
              eq(member.organizationId, membership.organizationId),
              eq(member.id, membership.id),
              eq(member.userId, input.userId),
            ),
          )
          .pipe(mapDatabaseErrors())
        yield* retireImage({
          organizationId: membership.organizationId,
          fileId: membership.avatarFileId,
        })
      }
    }).pipe(Effect.catchCause(() => Effect.logWarning("Optional profile image import failed"))),
  }),
)

export default profileImageImport
