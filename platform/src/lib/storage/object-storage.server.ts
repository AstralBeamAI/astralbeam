import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3"
import { Context, Effect, Layer, RcMap, Schema, SynchronizedRef } from "effect"

import { Config } from "@/lib/config/config.server"
import { StorageObjectMissing, StorageUnavailable } from "./errors"
import type { StorageConnection } from "./schemas"

type StorageFailure = StorageObjectMissing | StorageUnavailable

const storageRequest = <A>(call: (signal: AbortSignal) => PromiseLike<A>) =>
  Effect.tryPromise({
    try: call,
    catch: (error) => error,
  }).pipe(
    Effect.timeout("30 seconds"),
    Effect.tapError((error) =>
      Effect.logWarning("Object storage request failed").pipe(
        Effect.annotateLogs({
          errorType: error instanceof Error ? error.name : "Unknown",
          errorCode:
            error instanceof Error && "code" in error && typeof error.code === "string"
              ? error.code
              : undefined,
          httpStatusCode:
            error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined,
          requestId: error instanceof S3ServiceException ? error.$metadata.requestId : undefined,
        }),
      ),
    ),
    Effect.mapError((error) =>
      error instanceof Error && ["NoSuchKey", "NotFound"].includes(error.name)
        ? new StorageObjectMissing()
        : new StorageUnavailable(),
    ),
  )

const acquireStorageClient = (settings: StorageConnection) =>
  Effect.acquireRelease(
    Effect.sync(
      () =>
        new S3Client({
          endpoint: settings.endpoint,
          region: settings.region,
          credentials: {
            accessKeyId: settings.accessKeyId,
            secretAccessKey: settings.secretAccessKey,
          },
          forcePathStyle: settings.pathStyle,
          maxAttempts: 2,
          // R2 and other compatible backends do not implement every optional AWS checksum feature.
          // https://developers.cloudflare.com/r2/api/s3/api/
          requestChecksumCalculation: "WHEN_REQUIRED",
          responseChecksumValidation: "WHEN_REQUIRED",
        }),
    ),
    (client) => Effect.sync(() => client.destroy()),
  )

export class ObjectStorage extends Context.Service<
  ObjectStorage,
  {
    readonly put: (input: {
      key: string
      bytes: Uint8Array
      contentType: string
    }) => Effect.Effect<void, StorageFailure>
    readonly get: (input: {
      key: string
      maxBytes: number
    }) => Effect.Effect<Uint8Array, StorageFailure>
    readonly head: (input: {
      key: string
    }) => Effect.Effect<{ size: number; contentType: string }, StorageFailure>
    readonly remove: (input: { key: string }) => Effect.Effect<void, StorageFailure>
    readonly testConnection: (settings: StorageConnection) => Effect.Effect<void, StorageFailure>
  }
>()("astralbeam/storage/ObjectStorage") {
  static readonly layerNoDeps = Layer.effect(
    ObjectStorage,
    Effect.gen(function* () {
      const config = yield* Config
      const destinationReserved = yield* SynchronizedRef.make(false)
      const clients = yield* RcMap.make({
        lookup: acquireStorageClient,
        idleTimeToLive: "1 minute",
      })
      const settings = Effect.map(config.snapshot, ({ values }): StorageConnection => ({
        endpoint: values.s3_endpoint!,
        region: values.s3_region!,
        bucket: values.s3_bucket!,
        accessKeyId: values.s3_access_key_id!,
        secretAccessKey: values.s3_secret_access_key!,
        pathStyle: values.s3_path_style === "true",
      }))

      const withClient = <A>(
        run: (client: S3Client, connection: StorageConnection) => Effect.Effect<A, StorageFailure>,
      ) =>
        Effect.scoped(
          Effect.flatMap(settings, (connection) =>
            Effect.flatMap(RcMap.get(clients, connection), (client) => run(client, connection)),
          ),
        )

      const readObjectBytes = (client: S3Client, bucket: string, key: string, maxBytes: number) =>
        storageRequest(async (abortSignal) => {
          const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
            abortSignal,
          })
          if (!object.Body) throw new StorageUnavailable()
          const reader = (
            object.Body.transformToWebStream() as ReadableStream<Uint8Array>
          ).getReader()
          const cancelRead = () => void reader.cancel().catch(() => undefined)
          abortSignal.addEventListener("abort", cancelRead, { once: true })
          try {
            if (object.ContentLength !== undefined && object.ContentLength > maxBytes)
              throw new StorageUnavailable()
            const chunks: Uint8Array[] = []
            let size = 0
            while (true) {
              const chunk = await reader.read()
              if (chunk.done) break
              size += chunk.value.length
              if (size > maxBytes) throw new StorageUnavailable()
              chunks.push(chunk.value)
            }
            const bytes = new Uint8Array(size)
            let offset = 0
            for (const chunk of chunks) {
              bytes.set(chunk, offset)
              offset += chunk.length
            }
            return bytes
          } finally {
            abortSignal.removeEventListener("abort", cancelRead)
            await reader.cancel()
            reader.releaseLock()
          }
        })
      const removeObject = (client: S3Client, bucket: string, key: string, versionId?: string) =>
        storageRequest((abortSignal) =>
          client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }), {
            abortSignal,
          }),
        ).pipe(Effect.asVoid)

      return ObjectStorage.of({
        put: Effect.fn("ObjectStorage.put")((input) =>
          withClient((client, connection) =>
            SynchronizedRef.updateEffect(destinationReserved, (reserved) =>
              reserved
                ? Effect.succeed(true)
                : config.reserveStorageDestination(connection).pipe(Effect.as(true)),
            ).pipe(
              Effect.catchTag("StorageDestinationLocked", () =>
                Effect.fail(new StorageUnavailable()),
              ),
              Effect.andThen(
                storageRequest((abortSignal) =>
                  client.send(
                    new PutObjectCommand({
                      Bucket: connection.bucket,
                      Key: input.key,
                      Body: input.bytes,
                      ContentType: input.contentType,
                    }),
                    { abortSignal },
                  ),
                ),
              ),
              Effect.asVoid,
            ),
          ),
        ),
        get: Effect.fn("ObjectStorage.get")((input) =>
          withClient((client, connection) =>
            readObjectBytes(client, connection.bucket, input.key, input.maxBytes),
          ),
        ),
        head: Effect.fn("ObjectStorage.head")((input) =>
          withClient((client, connection) =>
            storageRequest(async (abortSignal) => {
              const object = await client.send(
                new HeadObjectCommand({ Bucket: connection.bucket, Key: input.key }),
                { abortSignal },
              )
              return {
                size: Schema.decodeUnknownSync(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))(
                  object.ContentLength,
                ),
                contentType: object.ContentType ?? "application/octet-stream",
              }
            }),
          ),
        ),
        remove: Effect.fn("ObjectStorage.remove")((input) =>
          withClient((client, connection) => removeObject(client, connection.bucket, input.key)),
        ),
        testConnection: Effect.fn("ObjectStorage.testConnection")((connection) =>
          Effect.scoped(
            Effect.gen(function* () {
              const client = yield* acquireStorageClient(connection)
              const key = `connection-tests/${crypto.randomUUID()}`
              const bytes = crypto.getRandomValues(new Uint8Array(32))
              let versionId: string | undefined
              yield* Effect.gen(function* () {
                yield* storageRequest(async (abortSignal) => {
                  const object = await client.send(
                    new PutObjectCommand({
                      Bucket: connection.bucket,
                      Key: key,
                      Body: bytes,
                      ContentType: "application/octet-stream",
                    }),
                    { abortSignal },
                  )
                  versionId = object.VersionId
                })
                const object = yield* storageRequest((abortSignal) =>
                  client.send(new HeadObjectCommand({ Bucket: connection.bucket, Key: key }), {
                    abortSignal,
                  }),
                )
                const actual = yield* readObjectBytes(client, connection.bucket, key, bytes.length)
                if (
                  object.ContentLength !== bytes.length ||
                  !bytes.every((value, index) => actual[index] === value)
                )
                  return yield* new StorageUnavailable()
              }).pipe(
                Effect.onError(() =>
                  removeObject(client, connection.bucket, key, versionId).pipe(
                    Effect.catch(() => Effect.logWarning("Storage connection test cleanup failed")),
                  ),
                ),
              )
              yield* removeObject(client, connection.bucket, key, versionId)
              yield* storageRequest((abortSignal) =>
                client.send(new HeadObjectCommand({ Bucket: connection.bucket, Key: key }), {
                  abortSignal,
                }),
              ).pipe(
                Effect.matchEffect({
                  onFailure: (error) =>
                    error._tag === "StorageObjectMissing" ? Effect.void : Effect.fail(error),
                  onSuccess: () => Effect.fail(new StorageUnavailable()),
                }),
              )
            }),
          ),
        ),
      })
    }),
  )

  static readonly layer = ObjectStorage.layerNoDeps.pipe(Layer.provide(Config.layer))
}
