import { Context, Effect, Fiber, Layer } from "effect"
import { expect, it, vi } from "@effect/vitest"
import type { fileObject } from "@/db/schema/files"
import { FilePreviews, FilePreviewRenderer } from "./file-previews.server"
import { ObjectStorage } from "./object-storage.server"
import { StoredFiles } from "./stored-files.server"
import { StorageObjectMissing } from "./errors"

const previewFile = {
  organizationId: "019a0000-0000-7000-8000-000000000001",
  id: "019a0000-0000-7000-8000-000000000002",
  objectKey: "preview-test",
  status: "stored",
  byteSize: 1,
  contentType: "image/png",
  sha256: "0".repeat(64),
  createdAt: new Date(0),
  updatedAt: new Date(0),
} satisfies typeof fileObject.$inferSelect

const previewTest = Effect.gen(function* () {
  const native = {
    draining: false,
    writes: 0,
    metadata: [] as Array<() => void>,
    output: [] as Array<{ resolve: () => void; reject: () => void }>,
  }
  const layer = FilePreviews.layerNoDeps.pipe(
    Layer.provide([
      Layer.succeed(FilePreviewRenderer, (_file, _bytes, signal) =>
        Effect.tryPromise(async () => {
          await new Promise<void>((resolve) =>
            native.draining ? resolve() : native.metadata.push(resolve),
          )
          signal.throwIfAborted()
          const output = await new Promise<Uint8Array>((resolve, reject) => {
            if (native.draining) return resolve(Uint8Array.of(1))
            native.output.push({
              resolve: () => resolve(Uint8Array.of(1)),
              reject: () => reject(new Error("native failure")),
            })
          })
          signal.throwIfAborted()
          return output
        }).pipe(Effect.catch(() => Effect.succeed(undefined))),
      ),
      Layer.succeed(StoredFiles, {
        read: () => Effect.succeed(Uint8Array.of(1)),
        upload: () => Effect.die("unused"),
      }),
      Layer.succeed(ObjectStorage, {
        get: () => Effect.fail(new StorageObjectMissing()),
        put: () =>
          Effect.sync(() => {
            native.writes++
          }),
        head: () => Effect.succeed({ size: 1, contentType: "image/png" }),
        remove: () => Effect.void,
        testConnection: () => Effect.void,
        signedUrl: () => Effect.die("unused"),
      }),
    ]),
  )
  const previews = Context.get(yield* Layer.build(layer), FilePreviews)
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      native.draining = true
      for (const resolve of native.metadata) resolve()
      for (const output of native.output) output.resolve()
    }),
  )
  return { native, read: previews.read({ file: previewFile }) }
})

it.effect.each(["metadata", "output"] as const)(
  "canceling %s retains native capacity until settlement",
  (phase) =>
    Effect.gen(function* () {
      const { native, read } = yield* previewTest
      const first = yield* Effect.forkChild(read)
      const second = yield* Effect.forkChild(read)
      yield* Effect.promise(() => vi.waitUntil(() => native.metadata.length === 2))
      if (phase === "output") native.metadata[0]!()
      yield* Effect.promise(() =>
        vi.waitUntil(() => native.output.length === (phase === "output" ? 1 : 0)),
      )
      yield* Fiber.interrupt(first)
      expect((yield* Fiber.await(first))._tag).toBe("Failure")
      const third = yield* Effect.forkChild(read)
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)))
      expect(native.metadata).toHaveLength(2)
      if (phase === "metadata") native.metadata[0]!()
      else native.output[0]!.reject()
      yield* Effect.promise(() => vi.waitUntil(() => native.metadata.length === 3))
      expect(native.output).toHaveLength(phase === "metadata" ? 0 : 1)
      native.metadata[1]!()
      native.metadata[2]!()
      yield* Effect.promise(() =>
        vi.waitUntil(() => native.output.length === (phase === "metadata" ? 2 : 3)),
      )
      for (const output of native.output) output.resolve()
      expect(yield* Fiber.join(second)).toMatchObject({ mimeType: "image/webp" })
      expect(yield* Fiber.join(third)).toMatchObject({ mimeType: "image/webp" })
      expect(native.writes).toBe(2)
    }),
)

it.effect("canceling queued work never starts a native operation", () =>
  Effect.gen(function* () {
    const { native, read } = yield* previewTest
    const first = yield* Effect.forkChild(read)
    const second = yield* Effect.forkChild(read)
    yield* Effect.promise(() => vi.waitUntil(() => native.metadata.length === 2))
    const queued = yield* Effect.forkChild(read)
    yield* Fiber.interrupt(queued)
    expect((yield* Fiber.await(queued))._tag).toBe("Failure")
    for (const resolve of native.metadata) resolve()
    yield* Effect.promise(() => vi.waitUntil(() => native.output.length === 2))
    for (const output of native.output) output.resolve()
    yield* Fiber.join(first)
    yield* Fiber.join(second)
    expect(native.metadata).toHaveLength(2)
  }),
)
