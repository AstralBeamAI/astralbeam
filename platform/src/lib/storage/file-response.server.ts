import { and, eq } from "drizzle-orm"
import { getSignedUrl } from "@aws-sdk/cloudfront-signer"
import { Clock, Effect } from "effect"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { fileObject } from "@/db/schema/files"
import { Config } from "@/lib/config/config"
import { StorageObjectMissing, StorageUnavailable } from "./errors"
import type { SignInRequired } from "@/lib/organizations/errors"
import { reportFailure } from "@/lib/runtime/failure-report.server"
import { ObjectStorage } from "./object-storage.server"

// Controllers authorize access before issuing a URL. The URL is valid for one minute.
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
  const { values, issues } = yield* (yield* Config).snapshot
  if (issues.some((issue) => /^(?:s3|cloudfront)_/.test(issue.key)))
    return yield* new StorageUnavailable()
  const origin = values.cloudfront_download_origin
  const keyPairId = values.cloudfront_key_pair_id
  const privateKey = values.cloudfront_private_key
  if (!origin && !keyPairId && !privateKey) return yield* (yield* ObjectStorage).signedUrl(file)
  if (!origin || !keyPairId || !privateKey) return yield* new StorageUnavailable()
  const now = yield* Clock.currentTimeMillis
  return yield* Effect.try({
    try: () =>
      getSignedUrl({
        url: `${origin}/${file.key.split("/").map(encodeURIComponent).join("/")}`,
        keyPairId,
        privateKey,
        algorithm: "SHA256",
        dateLessThan: new Date((Math.floor(now / 1000) + 60) * 1000).toISOString(),
      }),
    catch: () => new StorageUnavailable(),
  })
})

export function fileResponse<R>(
  url: Effect.Effect<string, SignInRequired | StorageObjectMissing | StorageUnavailable, R>,
): Effect.Effect<Response, never, R> {
  return url.pipe(
    Effect.map((location) => new Response(null, { status: 302, headers: { location } })),
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
