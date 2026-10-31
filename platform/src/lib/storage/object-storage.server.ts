import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { Context, Effect, Layer, RcMap, Schema } from "effect"

import { Config } from "@/lib/config/config"
import type { ConfigValues } from "@/lib/config/types"
import { StorageObjectMissing, StorageUnavailable } from "./errors"
import {
  getFileSystemObject,
  headFileSystemObject,
  putFileSystemObject,
  removeFileSystemObject,
} from "./filesystem.server"
import { isStorageSettingActive, type StorageConnection } from "./schemas"

type StorageFailure = StorageObjectMissing | StorageUnavailable

const storageObjectMissing = (error: unknown) =>
  error instanceof Error &&
  (["NoSuchKey", "NotFound"].includes(error.name) || ("code" in error && error.code === "ENOENT"))

const storageRequest = <A>(call: (signal: AbortSignal) => PromiseLike<A>) =>
  Effect.tryPromise({
    try: call,
    catch: (error) => error,
  }).pipe(
    Effect.timeout("30 seconds"),
    Effect.tapError((error) =>
      storageObjectMissing(error)
        ? Effect.void
        : Effect.logWarning("Object storage request failed", {
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
    Effect.mapError((error) =>
      storageObjectMissing(error) ? new StorageObjectMissing() : new StorageUnavailable(),
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
    readonly signedUrl: (input: {
      key: string
      contentType?: string
      contentDisposition?: string
    }) => Effect.Effect<string | undefined, StorageFailure>
    readonly testConnection: (settings: StorageConnection) => Effect.Effect<void, StorageFailure>
  }
>()("astralbeam/storage/ObjectStorage") {
  // Provides S3 operations using operator settings and scoped, reusable clients.
  // Application object access fails when storage settings are invalid.
  static readonly layerNoDeps = Layer.effect(
    ObjectStorage,
    Effect.gen(function* () {
      const config = yield* Config
      // Snapshot values keep the client cache key stable across requests.
      const clients = yield* RcMap.make({
        lookup: (values: ConfigValues) =>
          acquireStorageClient({
            endpoint: values.s3_endpoint!,
            region: values.s3_region!,
            bucket: values.s3_bucket!,
            accessKeyId: values.s3_access_key_id!,
            secretAccessKey: values.s3_secret_access_key!,
            pathStyle: values.s3_path_style === "true",
          }),
        idleTimeToLive: "1 minute",
      })
      const settings = Effect.flatMap(config.snapshot, ({ values, issues }) =>
        issues.some(
          ({ key }) =>
            (key.startsWith("storage_") || key.startsWith("s3_")) &&
            isStorageSettingActive(key, values.storage_provider),
        )
          ? Effect.fail(new StorageUnavailable())
          : Effect.succeed(values),
      )

      const withStorage = <A>(
        run: (
          client: S3Client,
          connection: Pick<StorageConnection, "bucket">,
        ) => Effect.Effect<A, StorageFailure>,
        local: (directory: string, signal: AbortSignal) => PromiseLike<A>,
      ) =>
        Effect.scoped(
          Effect.flatMap(settings, (values) =>
            values.storage_provider === "filesystem"
              ? storageRequest((signal) => local(values.storage_directory!, signal))
              : Effect.flatMap(RcMap.get(clients, values), (client) =>
                  run(client, { bucket: values.s3_bucket! }),
                ),
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
            const bytes = Buffer.concat(chunks, size)
            return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
          } finally {
            abortSignal.removeEventListener("abort", cancelRead)
            await reader.cancel()
            reader.releaseLock()
          }
        })
      const removeObject = (client: S3Client, bucket: string, key: string) =>
        storageRequest((abortSignal) =>
          client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
            abortSignal,
          }),
        ).pipe(Effect.asVoid)

      return ObjectStorage.of({
        put: Effect.fn("ObjectStorage.put")((input) =>
          withStorage(
            (client, connection) =>
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
              ).pipe(Effect.asVoid),
            (directory, signal) => putFileSystemObject({ ...input, directory, signal }),
          ),
        ),
        get: Effect.fn("ObjectStorage.get")((input) =>
          withStorage(
            (client, connection) =>
              readObjectBytes(client, connection.bucket, input.key, input.maxBytes),
            (directory, signal) => getFileSystemObject({ ...input, directory, signal }),
          ),
        ),
        head: Effect.fn("ObjectStorage.head")((input) =>
          withStorage(
            (client, connection) =>
              storageRequest(async (abortSignal) => {
                const object = await client.send(
                  new HeadObjectCommand({ Bucket: connection.bucket, Key: input.key }),
                  { abortSignal },
                )
                return {
                  size: Schema.decodeUnknownSync(
                    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
                  )(object.ContentLength),
                  contentType: object.ContentType ?? "application/octet-stream",
                }
              }),
            (directory) => headFileSystemObject({ ...input, directory }),
          ),
        ),
        remove: Effect.fn("ObjectStorage.remove")((input) =>
          withStorage(
            (client, connection) => removeObject(client, connection.bucket, input.key),
            (directory) => removeFileSystemObject({ ...input, directory }),
          ),
        ),
        signedUrl: Effect.fn("ObjectStorage.signedUrl")((input) =>
          withStorage<string | undefined>(
            (client, connection) =>
              storageRequest(() =>
                getSignedUrl(
                  client,
                  new GetObjectCommand({
                    Bucket: connection.bucket,
                    Key: input.key,
                    ResponseCacheControl: "private, no-store",
                    ResponseContentType: input.contentType,
                    ResponseContentDisposition: input.contentDisposition,
                  }),
                  { expiresIn: 60 },
                ),
              ),
            () => Promise.resolve(undefined),
          ),
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
                const actual = yield* readObjectBytes(client, connection.bucket, key, bytes.length)
                if (
                  object.ContentLength !== bytes.length ||
                  !bytes.every((value, index) => actual[index] === value)
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
