import process from "node:process"
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { Effect, Layer } from "effect"
import { expect, test } from "vitest"

import { Config } from "@/lib/config/config.server"
import { ObjectStorage } from "./object-storage.server"
import { StorageDestinationLocked } from "./errors"

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
  let reservations = 0
  const layer = ObjectStorage.layerNoDeps.pipe(
    Layer.provide(
      Layer.succeed(Config, {
        reserveStorageDestination: () =>
          ++reservations === 1 ? Effect.fail(new StorageDestinationLocked()) : Effect.void,
        snapshot: Effect.succeed({
          issues: [],
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
        expect(
          (yield* storage.put({ key, bytes, contentType: "text/plain" }).pipe(Effect.result))._tag,
        ).toBe("Failure")
        yield* storage.put({ key, bytes, contentType: "text/plain" })
        try {
          yield* storage.put({ key, bytes, contentType: "text/plain" })
          expect(reservations).toBe(2)
          expect(yield* storage.head({ key })).toEqual({
            size: bytes.length,
            contentType: "text/plain",
          })
          expect(yield* storage.get({ key, maxBytes: bytes.length })).toEqual(bytes)
        } finally {
          yield* storage.remove({ key })
        }
        yield* Effect.promise(() =>
          client.send(
            new PutBucketVersioningCommand({
              Bucket: settings.bucket,
              VersioningConfiguration: { Status: "Enabled" },
            }),
          ),
        )
        yield* storage.testConnection(settings)
        yield* storage.put({ key, bytes, contentType: "text/plain" })
        yield* storage.put({ key, bytes, contentType: "text/plain" })
        yield* Effect.promise(() =>
          client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key })),
        )
        const beforeCleanup = yield* Effect.promise(() =>
          client.send(new ListObjectVersionsCommand({ Bucket: settings.bucket, Prefix: key })),
        )
        expect(beforeCleanup.Versions).toHaveLength(2)
        expect(beforeCleanup.DeleteMarkers).toHaveLength(1)
        yield* storage.remove({ key })
        const afterCleanup = yield* Effect.promise(() =>
          client.send(new ListObjectVersionsCommand({ Bucket: settings.bucket })),
        )
        expect(afterCleanup.Versions ?? []).toHaveLength(0)
        expect(afterCleanup.DeleteMarkers ?? []).toHaveLength(0)
      }).pipe(Effect.provide(layer)),
    )
  } finally {
    await client.send(new DeleteBucketCommand({ Bucket: settings.bucket }))
    client.destroy()
  }
})
