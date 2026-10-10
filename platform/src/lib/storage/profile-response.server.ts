import { and, eq, or, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { user } from "@/db/schema/authentication"
import { fileObject } from "@/db/schema/files"
import { organization } from "@/db/schema/organizations"
import { Auth } from "@/lib/auth/auth.server"
import { reportFailure } from "@/lib/runtime/failure-report.server"
import { ServerRequest } from "@/lib/runtime/server-request.server"
import { UuidV7Schema } from "@/lib/schemas"
import { StoredFiles } from "./stored-files.server"

export const profileImageResponse = Effect.fn("profileImageResponse")(
  function* (fileId: string, organizationId?: string) {
    if (
      !Schema.is(UuidV7Schema)(fileId) ||
      (organizationId && !Schema.is(UuidV7Schema)(organizationId))
    )
      return new Response(null, { status: 404 })
    const server = yield* ServerRequest
    const session = yield* (yield* Auth).requireSession({ headers: server.request.headers })
    const db = yield* Database
    const [file] = organizationId
      ? yield* db
          .select({ file: fileObject })
          .from(fileObject)
          .innerJoin(organization, eq(organization.id, fileObject.organizationId))
          .where(
            and(
              eq(fileObject.organizationId, organizationId),
              eq(fileObject.id, fileId),
              eq(organization.logoFileId, fileId),
              sql`exists (select 1 from member where organization_id = ${organizationId} and user_id = ${session.user.id})`,
            ),
          )
          .pipe(mapDatabaseErrors())
      : yield* db
          .select({ file: fileObject })
          .from(fileObject)
          .innerJoin(user, eq(user.id, fileObject.userId))
          .where(
            and(
              eq(fileObject.id, fileId),
              eq(user.avatarFileId, fileId),
              or(
                eq(fileObject.userId, session.user.id),
                sql`exists (select 1 from member colleague join member viewer on viewer.organization_id = colleague.organization_id where colleague.user_id = ${fileObject.userId} and viewer.user_id = ${session.user.id})`,
              ),
            ),
          )
          .pipe(mapDatabaseErrors())
    if (file?.file.status !== "stored") return new Response(null, { status: 404 })
    const bytes = yield* (yield* StoredFiles).read(file.file)
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": file.file.contentType,
        "content-length": String(bytes.length),
        "x-content-type-options": "nosniff",
      },
    })
  },
  Effect.catchTag("SignInRequired", () => Effect.succeed(new Response(null, { status: 401 }))),
  Effect.catchTag("StorageObjectMissing", () =>
    Effect.succeed(new Response(null, { status: 404 })),
  ),
  Effect.catchTag("StorageUnavailable", () => Effect.succeed(new Response(null, { status: 503 }))),
  Effect.catchCause((cause) =>
    Effect.map(
      reportFailure("profileImageResponse", cause),
      () => new Response(null, { status: 500 }),
    ),
  ),
  Effect.map((response) => {
    response.headers.set("cache-control", "private, no-store")
    return response
  }),
)
