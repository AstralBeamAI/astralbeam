import { and, eq } from "drizzle-orm"
import { Effect } from "effect"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { fileObject } from "@/db/schema/files"
import { StorageObjectMissing, type StorageUnavailable } from "./errors"
import type { SignInRequired } from "@/lib/organizations/errors"
import { reportFailure } from "@/lib/runtime/failure-report.server"
import { ObjectStorage } from "./object-storage.server"
import { StoredFiles } from "./stored-files.server"

// Controllers authorize access before local bytes or a one-minute S3 URL are returned.
export const fileDownloadResponse = Effect.fn("fileDownloadResponse")(function* ({
  organizationId,
  fileId,
}: {
  organizationId: string
  fileId: string
}) {
  const db = yield* Database
  const [file] = yield* db
    .select()
    .from(fileObject)
    .where(
      and(
        eq(fileObject.organizationId, organizationId),
        eq(fileObject.id, fileId),
        eq(fileObject.status, "stored"),
      ),
    )
    .pipe(mapDatabaseErrors())
  if (!file) return yield* new StorageObjectMissing()
  const location = yield* (yield* ObjectStorage).signedUrl({ key: file.objectKey })
  if (location) return new Response(null, { status: 302, headers: { location } })
  const bytes = yield* (yield* StoredFiles).read({ file })
  return new Response(bytes as BodyInit, {
    headers: {
      "content-type": file.contentType,
      "content-length": String(bytes.byteLength),
      "x-content-type-options": "nosniff",
    },
  })
})

export function fileResponse<R>(
  response: Effect.Effect<Response, SignInRequired | StorageObjectMissing | StorageUnavailable, R>,
): Effect.Effect<Response, never, R> {
  return response.pipe(
    Effect.catchTag("SignInRequired", () => Effect.succeed(new Response(null, { status: 401 }))),
    Effect.catchTag("StorageObjectMissing", () =>
      Effect.succeed(new Response(null, { status: 404 })),
    ),
    Effect.catchTag("StorageUnavailable", () =>
      Effect.succeed(new Response(null, { status: 503 })),
    ),
    Effect.catchCause((cause) =>
      Effect.as(reportFailure("fileResponse", cause), new Response(null, { status: 500 })),
    ),
    Effect.map((response) => {
      response.headers.set("cache-control", "private, no-store")
      return response
    }),
  )
}
