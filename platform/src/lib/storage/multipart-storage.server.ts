import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  ListMultipartUploadsCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { Context, Effect, Layer } from "effect"

import { Config } from "@/lib/config/config.server"
import { StorageUnavailable, MultipartMissing } from "./errors"
import {
  acquireStorageClient,
  objectStorageConnection,
  storageRequest,
} from "./object-storage.server"

export interface StoragePart {
  number: number
  size: number
  etag: string
}

export class MultipartStorage extends Context.Service<
  MultipartStorage,
  {
    readonly create: (key: string, contentType: string) => Effect.Effect<string, StorageUnavailable>
    readonly list: (
      key: string,
      uploadId: string,
    ) => Effect.Effect<StoragePart[], StorageUnavailable | MultipartMissing>
    readonly sign: (
      key: string,
      uploadId: string,
      number: number,
      byteSize: number,
    ) => Effect.Effect<string, StorageUnavailable>
    readonly complete: (
      key: string,
      uploadId: string,
      parts: readonly StoragePart[],
    ) => Effect.Effect<void, StorageUnavailable | MultipartMissing>
    readonly abort: (key: string, uploadId: string) => Effect.Effect<void, StorageUnavailable>
    readonly find: (key: string) => Effect.Effect<string[], StorageUnavailable>
  }
>()("astralbeam/storage/MultipartStorage") {
  static readonly layerNoDeps = Layer.effect(
    MultipartStorage,
    Effect.gen(function* () {
      const config = yield* Config
      const withClient = <A, E>(
        run: (
          client: Effect.Success<ReturnType<typeof acquireStorageClient>>,
          bucket: string,
        ) => Effect.Effect<A, E>,
      ) =>
        Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* objectStorageConnection(config)
            const client = yield* acquireStorageClient(connection)
            yield* config
              .reserveStorageDestination(connection)
              .pipe(Effect.mapError(() => new StorageUnavailable()))
            return yield* run(client, connection.bucket)
          }),
        )
      const request = <A>(call: (signal: AbortSignal) => Promise<A>) =>
        Effect.tryPromise({
          try: call,
          catch: (error) =>
            error instanceof Error && error.name === "NoSuchUpload"
              ? new MultipartMissing()
              : new StorageUnavailable(),
        }).pipe(
          Effect.timeout("30 seconds"),
          Effect.catchTag("TimeoutError", () => Effect.fail(new StorageUnavailable())),
        )
      const boundedRequest = <A>(call: (signal: AbortSignal) => PromiseLike<A>) =>
        storageRequest(call).pipe(Effect.mapError(() => new StorageUnavailable()))
      return MultipartStorage.of({
        create: (key, contentType) =>
          withClient((client, bucket) =>
            boundedRequest((abortSignal) =>
              client.send(
                new CreateMultipartUploadCommand({
                  Bucket: bucket,
                  Key: key,
                  ContentType: contentType,
                }),
                { abortSignal },
              ),
            ).pipe(
              Effect.flatMap((result) =>
                result.UploadId
                  ? Effect.succeed(result.UploadId)
                  : Effect.fail(new StorageUnavailable()),
              ),
            ),
          ),
        list: (key, uploadId) =>
          withClient((client, bucket) =>
            request((abortSignal) =>
              client.send(new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId }), {
                abortSignal,
              }),
            ).pipe(
              Effect.flatMap((result) =>
                result.IsTruncated
                  ? Effect.fail(new StorageUnavailable())
                  : Effect.succeed(
                      (result.Parts ?? []).map((part) => ({
                        number: part.PartNumber!,
                        size: part.Size!,
                        etag: part.ETag!,
                      })),
                    ),
              ),
            ),
          ),
        sign: (key, uploadId, number, byteSize) =>
          withClient((client, bucket) =>
            boundedRequest(() =>
              getSignedUrl(
                client,
                new UploadPartCommand({
                  Bucket: bucket,
                  Key: key,
                  UploadId: uploadId,
                  PartNumber: number,
                  ContentLength: byteSize,
                }),
                { expiresIn: 300 },
              ),
            ),
          ),
        complete: (key, uploadId, parts) =>
          withClient((client, bucket) =>
            request((abortSignal) =>
              client.send(
                new CompleteMultipartUploadCommand({
                  Bucket: bucket,
                  Key: key,
                  UploadId: uploadId,
                  MultipartUpload: {
                    Parts: parts.map((part) => ({ PartNumber: part.number, ETag: part.etag })),
                  },
                }),
                { abortSignal },
              ),
            ).pipe(Effect.asVoid),
          ),
        abort: (key, uploadId) =>
          withClient((client, bucket) =>
            request((abortSignal) =>
              client.send(
                new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
                { abortSignal },
              ),
            ).pipe(
              Effect.catchTag("MultipartMissing", () => Effect.void),
              Effect.asVoid,
            ),
          ),
        find: (key) =>
          withClient((client, bucket) =>
            boundedRequest((abortSignal) =>
              client.send(new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: key }), {
                abortSignal,
              }),
            ).pipe(
              Effect.flatMap((result) =>
                result.IsTruncated
                  ? Effect.fail(new StorageUnavailable())
                  : Effect.succeed(
                      (result.Uploads ?? [])
                        .filter((upload) => upload.Key === key)
                        .map((upload) => upload.UploadId!),
                    ),
              ),
            ),
          ),
      })
    }),
  )
  static readonly layer = MultipartStorage.layerNoDeps.pipe(Layer.provide(Config.layer))
}
