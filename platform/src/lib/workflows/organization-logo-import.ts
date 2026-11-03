import { and, eq, isNull, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Activity, Workflow } from "effect/workflow"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { organization } from "@/db/schema/organizations"
import { retireImage } from "@/lib/organizations/images.server"
import { UuidV7Schema } from "@/lib/schemas"
import { ImageSources } from "@/lib/storage/image-source.server"
import { StoredFiles } from "@/lib/storage/stored-files.server"

const organizationLogoImport = Workflow.make("OrganizationLogoImport/v3", {
  payload: { organizationId: UuidV7Schema, updatedAt: Schema.String, imageUrl: Schema.String },
  // A fresh execution lets an explicit refresh retry the same source URL.
  idempotencyKey: () => crypto.randomUUID(),
})

export const organizationLogoImportWorkflowLayer = organizationLogoImport.toLayer((input) =>
  Activity.make({
    name: "ImportLogo",
    execute: Effect.gen(function* () {
      const db = yield* Database
      const files = yield* StoredFiles
      const sources = yield* ImageSources
      const pending = and(
        eq(organization.id, input.organizationId),
        sql`${organization.updatedAt} = ${input.updatedAt}::timestamptz`,
        isNull(organization.logoFileId),
      )
      const [current] = yield* db
        .select({ id: organization.id })
        .from(organization)
        .where(pending)
        .pipe(mapDatabaseErrors())
      if (!current) return
      const image = yield* sources.fetch({ source: input.imageUrl })
      const file = yield* files.upload({
        ...image,
        organizationId: input.organizationId,
      })
      yield* db
        .update(organization)
        .set({ logoFileId: file.id })
        .where(pending)
        .pipe(mapDatabaseErrors())
      // A concurrent manual upload/removal wins. Retire the imported file if it was not attached.
      yield* retireImage({ organizationId: input.organizationId, fileId: file.id })
    }).pipe(Effect.catchCause(() => Effect.logWarning("Optional organization logo import failed"))),
  }),
)

export default organizationLogoImport
