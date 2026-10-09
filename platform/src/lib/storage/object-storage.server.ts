import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { Context, Effect, Layer, Option, Schema } from "effect"

import { Config } from "@/lib/config/config.server"
import { StorageObjectMissing, StorageUnavailable } from "./errors"
import { StorageConnectionSchema, type StorageConnection } from "./schemas"

type StorageFailure = StorageObjectMissing | StorageUnavailable

const storageRequest = <A>(call: (signal: AbortSignal) => PromiseLike<A>) =>
  Effect.tryPromise({
    try: call,
    catch: (error) =>
      error instanceof Error && ["NoSuchKey", "NotFound"].includes(error.name)
        ? new StorageObjectMissing()
        : new StorageUnavailable(),
  }).pipe(
    Effect.timeout("30 seconds"),
    Effect.catchTag("TimeoutError", () => Effect.fail(new StorageUnavailable())),
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
      const settings = Effect.map(config.snapshot, ({ values, issues }) => {
        if (issues.some((issue) => issue.key.startsWith("s3_")))
          return Option.none<StorageConnection>()
        return Schema.decodeUnknownOption(StorageConnectionSchema)({
          endpoint: values.s3_endpoint,
          region: values.s3_region,
          bucket: values.s3_bucket,
          accessKeyId: values.s3_access_key_id,
          secretAccessKey: values.s3_secret_access_key,
          pathStyle: values.s3_path_style === "true",
        })
      }).pipe(
        Effect.flatMap((value) =>
          Option.isSome(value)
            ? Effect.succeed(value.value)
            : Effect.fail(new StorageUnavailable()),
        ),
      )

      const withClient = <A>(
        run: (client: S3Client, connection: StorageConnection) => Effect.Effect<A, StorageFailure>,
      ) =>
        Effect.scoped(
          Effect.flatMap(settings, (connection) =>
            Effect.flatMap(acquireStorageClient(connection), (client) => run(client, connection)),
          ),
        )

      const read = (client: S3Client, bucket: string, key: string, maxBytes: number) =>
        storageRequest(async (abortSignal) => {
          const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
            abortSignal,
          })
          if (
            !object.Body ||
            (object.ContentLength !== undefined && object.ContentLength > maxBytes)
          )
            throw new StorageUnavailable()
          const reader = (
            object.Body.transformToWebStream() as ReadableStream<Uint8Array>
          ).getReader()
          const cancelRead = () => void reader.cancel().catch(() => undefined)
          abortSignal.addEventListener("abort", cancelRead, { once: true })
          try {
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
      const removeObject = (client: S3Client, bucket: string, key: string) =>
        storageRequest((abortSignal) =>
          client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal }),
        ).pipe(Effect.asVoid)

      return ObjectStorage.of({
        put: Effect.fn("ObjectStorage.put")((input) =>
          withClient((client, connection) =>
            config.reserveStorageDestination(connection).pipe(
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
            read(client, connection.bucket, input.key, input.maxBytes),
          ),
        ),
        head: Effect.fn("ObjectStorage.head")((input) =>
          withClient((client, connection) =>
            storageRequest((abortSignal) =>
              client.send(new HeadObjectCommand({ Bucket: connection.bucket, Key: input.key }), {
                abortSignal,
              }),
            ).pipe(
              Effect.flatMap((object) =>
                Schema.decodeUnknownEffect(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))(
                  object.ContentLength,
                ).pipe(
                  Effect.map((size) => ({
                    size,
                    contentType: object.ContentType ?? "application/octet-stream",
                  })),
                  Effect.mapError(() => new StorageUnavailable()),
                ),
              ),
            ),
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
              yield* Effect.gen(function* () {
                yield* storageRequest((abortSignal) =>
                  client.send(
                    new PutObjectCommand({
                      Bucket: connection.bucket,
                      Key: key,
                      Body: bytes,
                      ContentType: "application/octet-stream",
                    }),
                    { abortSignal },
                  ),
                )
                const object = yield* storageRequest((abortSignal) =>
                  client.send(new HeadObjectCommand({ Bucket: connection.bucket, Key: key }), {
                    abortSignal,
                  }),
                )
                const actual = yield* read(client, connection.bucket, key, bytes.length)
                if (
                  object.ContentLength !== bytes.length ||
                  !bytes.every((value, index) => actual[index] === value) ||
                  actual.length !== bytes.length
                )
                  return yield* new StorageUnavailable()
              }).pipe(
                Effect.onError(() =>
                  removeObject(client, connection.bucket, key).pipe(
                    Effect.catch(() => Effect.logWarning("Storage connection test cleanup failed")),
                  ),
                ),
              )
              yield* removeObject(client, connection.bucket, key)
            }),
          ),
        ),
      })
    }),
  )

  static readonly layer = ObjectStorage.layerNoDeps.pipe(Layer.provide(Config.layer))
}
