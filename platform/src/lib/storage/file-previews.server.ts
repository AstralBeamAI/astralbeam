import { Context, Effect, Fiber, Layer, Semaphore } from "effect"
import sharp, { type Sharp } from "sharp"

import type { fileObject } from "@/db/schema/files"
import { StorageObjectMissing, StorageUnavailable } from "./errors"
import { StoredFiles } from "./stored-files.server"
import { ObjectStorage } from "./object-storage.server"

type StoredFile = typeof fileObject.$inferSelect
type FilePreview = { bytes: Uint8Array; mimeType: "image/webp" }
export const filePreviewObjectKey = (objectKey: string) => `${objectKey}.preview.webp`
const imageTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"]
const textTypes = [
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/x-ndjson",
  "application/sql",
  "application/x-sh",
  "application/javascript",
  "application/typescript",
  "application/csv",
  "image/svg+xml",
]

const renderPreview = Effect.fn("FilePreviews.render")(
  (
    file: StoredFile,
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Effect.Effect<Uint8Array | undefined> =>
    Effect.tryPromise(async () => {
      signal.throwIfAborted()
      let image: Sharp
      if (imageTypes.includes(file.contentType)) {
        image = sharp(bytes, { failOn: "warning", limitInputPixels: 16_777_216 })
        const { format } = await image.metadata()
        signal.throwIfAborted()
        if (!["png", "jpeg", "gif", "webp"].includes(format)) return
        image.rotate()
      } else {
        const text = new TextDecoder("utf-8", { fatal: true })
          .decode(bytes.subarray(0, 16_384), { stream: true })
          .replaceAll(/\p{Cc}/gu, (character) =>
            character === "\n" ? "\n" : character === "\t" ? "  " : "",
          )
          .split("\n")
          .slice(0, 14)
          .map((line) => line.slice(0, 40))
          .join("\n")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
        image = sharp({
          text: { text: text || " ", font: "monospace 12", width: 288, dpi: 72, rgba: true },
        })
          .flatten({ background: "#ffffff" })
          .extend({ top: 12, bottom: 12, left: 12, right: 12, background: "#ffffff" })
      }
      const preview = await image
        .timeout({ seconds: 5 })
        .resize(320, 240, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 75 })
        .toBuffer()
      signal.throwIfAborted()
      return preview
    }).pipe(Effect.catch(() => Effect.succeed(undefined))),
)

export const FilePreviewRenderer = Context.Reference("astralbeam/storage/FilePreviewRenderer", {
  defaultValue: () => renderPreview,
})

export class FilePreviews extends Context.Service<
  FilePreviews,
  {
    readonly read: (input: {
      file: StoredFile
    }) => Effect.Effect<FilePreview | undefined, StorageUnavailable | StorageObjectMissing>
  }
>()("astralbeam/storage/FilePreviews") {
  static readonly layerNoDeps = Layer.effect(
    FilePreviews,
    Effect.gen(function* () {
      const files = yield* StoredFiles
      const storage = yield* ObjectStorage
      const render = yield* FilePreviewRenderer
      const renders = yield* Semaphore.make(2)
      const scope = yield* Effect.scope
      const read = Effect.fn("FilePreviews.read")(function* ({ file }: { file: StoredFile }) {
        if (
          file.status !== "stored" ||
          file.byteSize > 10 * 1024 * 1024 ||
          !(
            imageTypes.includes(file.contentType) ||
            file.contentType.startsWith("text/") ||
            file.contentType.endsWith("+json") ||
            file.contentType.endsWith("+xml") ||
            textTypes.includes(file.contentType)
          )
        )
          return
        const key = filePreviewObjectKey(file.objectKey)
        const cached = yield* storage
          .get({ key, maxBytes: 256 * 1024 })
          .pipe(Effect.catchTag("StorageObjectMissing", () => Effect.succeed(undefined)))
        if (cached) return { bytes: cached, mimeType: "image/webp" as const }
        const controller = new AbortController()
        const bytes = yield* Effect.acquireUseRelease(
          files.read({ file }).pipe(
            // Native work cannot be interrupted. Its service-owned fiber retains the permit.
            Effect.flatMap((source) =>
              render(file, source, controller.signal).pipe(Effect.uninterruptible),
            ),
            Semaphore.withPermit(renders),
            Effect.forkIn(scope, { uninterruptible: false }),
          ),
          Fiber.join,
          (job) =>
            Effect.sync(() => controller.abort()).pipe(
              Effect.andThen(Fiber.interrupt(job).pipe(Effect.forkIn(scope))),
            ),
        )
        if (!bytes) return
        yield* storage.put({ key, bytes, contentType: "image/webp" })
        const source = yield* storage
          .head({ key: file.objectKey })
          .pipe(Effect.catchTag("StorageObjectMissing", () => Effect.succeed(undefined)))
        if (!source) {
          yield* storage.remove({ key }).pipe(Effect.catch(() => Effect.void))
          return
        }
        return { bytes, mimeType: "image/webp" as const }
      })
      return FilePreviews.of({ read })
    }),
  )
  static readonly layer = FilePreviews.layerNoDeps.pipe(
    Layer.provide([StoredFiles.layer, ObjectStorage.layer]),
  )
}
