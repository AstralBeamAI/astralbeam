import { createFileRoute } from "@tanstack/react-router"
import { and, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { member, organization } from "@/db/schema/organizations"
import { Auth } from "@/lib/auth/auth.server"
import { ServerRequest } from "@/lib/runtime/server-request.server"
import { runRouteEffect } from "@/lib/runtime/server-fn.server"
import { UuidV7Schema } from "@/lib/schemas"
import { StorageObjectMissing } from "@/lib/storage/errors"
import { fileDownloadUrl, fileResponse } from "@/lib/storage/file-response.server"

const logoDownloadUrl = Effect.fn("logoDownloadUrl")(function* ({
  organizationId,
  fileId,
}: {
  organizationId: string
  fileId: string
}) {
  if (!Schema.is(UuidV7Schema)(fileId) || !Schema.is(UuidV7Schema)(organizationId))
    return yield* new StorageObjectMissing()
  const server = yield* ServerRequest
  const session = yield* (yield* Auth).requireSession({ headers: server.request.headers })
  const db = yield* Database
  const [access] = yield* db
    .select({ id: member.id })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.userId, session.user.id),
        eq(organization.logoFileId, fileId),
      ),
    )
    .pipe(mapDatabaseErrors())
  if (!access) return yield* new StorageObjectMissing()
  return yield* fileDownloadUrl({ organizationId, fileId })
})

export const Route = createFileRoute("/api/files/organizations/$organizationId/logos/$fileId")({
  server: {
    handlers: {
      GET: ({ params }) => runRouteEffect(fileResponse(logoDownloadUrl(params))),
    },
  },
})
