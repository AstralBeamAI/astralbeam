import process from "node:process"
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from "@aws-sdk/client-s3"
import { Effect, Layer } from "effect"
import { expect, test } from "vitest"

import { Config } from "@/lib/config/config.server"
import { ObjectStorage } from "./object-storage.server"

test.runIf(Boolean(process.env.S3_TEST_ENDPOINT))("S3-compatible object round trip", async () => {
  const settings = {
    endpoint: process.env.S3_TEST_ENDPOINT!,
    region: "us-east-1",
    bucket: `storage-test-${crypto.randomUUID()}`,
    accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY!,
    pathStyle: true,
  }
  const client = new S3Client({
    ...settings,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
  })
  const layer = ObjectStorage.layerNoDeps.pipe(
    Layer.provide(
      Layer.succeed(Config, {
        snapshot: Effect.succeed({
          values: {
            s3_endpoint: settings.endpoint,
            s3_region: settings.region,
            s3_bucket: settings.bucket,
            s3_access_key_id: settings.accessKeyId,
            s3_secret_access_key: settings.secretAccessKey,
            s3_path_style: "true",
          },
        }),
      } as unknown as Config["Service"]),
    ),
  )
  await client.send(new CreateBucketCommand({ Bucket: settings.bucket }))
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const storage = yield* ObjectStorage
        yield* storage.testConnection(settings)
        const bytes = new TextEncoder().encode("stored file")
        const key = crypto.randomUUID()
        yield* storage.put({ key, bytes, contentType: "text/plain" })
        try {
          expect(yield* storage.head({ key })).toEqual({
            size: bytes.length,
            contentType: "text/plain",
          })
          expect(yield* storage.get({ key, maxBytes: bytes.length })).toEqual(bytes)
        } finally {
          yield* storage.remove({ key })
        }
      }).pipe(Effect.provide(layer)),
    )
  } finally {
    await client.send(new DeleteBucketCommand({ Bucket: settings.bucket }))
    client.destroy()
  }
})
