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

const organizationLogoImport = Workflow.make("OrganizationLogoImport/v2", {
  payload: { organizationId: UuidV7Schema, updatedAt: Schema.String },
  idempotencyKey: () => crypto.randomUUID(),
})

export const queueOrganizationLogoImport = Effect.fn("queueOrganizationLogoImport")(function* (
  organizationId: string,
) {
  const db = yield* Database
  const [current] = yield* db
    .select({ updatedAt: sql<string>`${organization.updatedAt}::text` })
    .from(organization)
    .where(and(eq(organization.id, organizationId), isNull(organization.logoFileId)))
    .pipe(mapDatabaseErrors())
  if (current)
    yield* organizationLogoImport.execute(
      { organizationId, updatedAt: current.updatedAt },
      { discard: true },
    )
})

export const organizationLogoImportWorkflowLayer = organizationLogoImport.toLayer((input) =>
  Activity.make({
    name: "ImportLogo",
    execute: Effect.gen(function* () {
      const db = yield* Database
      const pending = and(
        eq(organization.id, input.organizationId),
        sql`${organization.updatedAt} = ${input.updatedAt}::timestamptz`,
        isNull(organization.logoFileId),
      )
      const [current] = yield* db
        .select({ domain: organization.domain })
        .from(organization)
        .where(pending)
        .pipe(mapDatabaseErrors())
      if (!current) return
      // Google S2 is an undocumented, best-effort favicon source. Missing icons return HTTP 404.
      // Keep the initials fallback if lookup fails, and persist valid images in our own storage.
      const source = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(current.domain)}&sz=128`
      const image = yield* (yield* ImageSources).fetch({ source })
      const file = yield* (yield* StoredFiles).upload({
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
