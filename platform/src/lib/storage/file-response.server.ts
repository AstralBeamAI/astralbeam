import { and, eq } from "drizzle-orm"
import { Effect } from "effect"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { fileObject } from "@/db/schema/files"
import { Config } from "@/lib/config/config"
import { StorageObjectMissing, type StorageUnavailable } from "./errors"
import { assetProxyResponse } from "./asset-proxy.server"
import type { SignInRequired } from "@/lib/organizations/errors"
import { reportFailure } from "@/lib/runtime/failure-report.server"
import { ServerRequest } from "@/lib/runtime/server-request.server"
import { ObjectStorage } from "./object-storage.server"

// Controllers authorize the current file reference before either delivery strategy signs it.
export const fileDownloadUrl = Effect.fn("fileDownloadUrl")(function* ({
  organizationId,
  fileId,
}: {
  organizationId: string
  fileId: string
}) {
  const db = yield* Database
  const [file] = yield* db
    .select({ key: fileObject.objectKey })
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
  const { request } = yield* ServerRequest
  return yield* (yield* ObjectStorage).signedUrl({
    ...file,
    method: request.method === "HEAD" ? "HEAD" : "GET",
  })
})

export function fileResponse<R>(
  url: Effect.Effect<string, SignInRequired | StorageObjectMissing | StorageUnavailable, R>,
): Effect.Effect<Response, never, R | ServerRequest | Config> {
  return Effect.gen(function* () {
    const { values } = yield* (yield* Config).snapshot
    if (values.asset_delivery === "proxy") {
      const { request } = yield* ServerRequest
      // This detects a missing proxy handler. File access still requires the controller's session.
      if (request.headers.get("x-asset-proxy") !== "1") return new Response(null, { status: 503 })
    }
    const location = yield* url
    if (values.asset_delivery !== "proxy")
      return new Response(null, { status: 302, headers: { location } })
    return yield* assetProxyResponse(location)
  }).pipe(
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
