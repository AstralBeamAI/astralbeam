import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, expect, test, vi } from "vitest"
import type { fileObject } from "@/db/schema/files"
import { FilePreviews } from "./file-previews.server"
import { ObjectStorage } from "./object-storage.server"
import { StoredFiles } from "./stored-files.server"
import { StorageObjectMissing } from "./errors"

const native = vi.hoisted(() => ({
  draining: false,
  metadata: [] as Array<() => void>,
  output: [] as Array<{ resolve: () => void; reject: () => void }>,
}))
vi.mock("sharp", () => ({
  default: () => {
    const image = {
      metadata: () =>
        native.draining
          ? Promise.resolve({ format: "png" })
          : new Promise((resolve) => {
              native.metadata.push(() => resolve({ format: "png" }))
            }),
      rotate: () => image,
      timeout: () => image,
      resize: () => image,
      webp: () => image,
      toBuffer: () =>
        native.draining
          ? Promise.resolve(Uint8Array.of(1))
          : new Promise((resolve, reject) => {
              native.output.push({
                resolve: () => resolve(Uint8Array.of(1)),
                reject: () => reject(new Error("native failure")),
              })
            }),
    }
    return image
  },
}))

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
const writes = vi.fn(() => Effect.void)
const previewTestLayer = FilePreviews.layerNoDeps.pipe(
  Layer.provide([
    Layer.succeed(StoredFiles, {
      read: () => Effect.succeed(Uint8Array.of(1)),
      upload: () => Effect.die("unused"),
    }),
    Layer.succeed(ObjectStorage, {
      get: () => Effect.fail(new StorageObjectMissing()),
      put: writes,
      head: () => Effect.succeed({ size: 1, contentType: "image/png" }),
      remove: () => Effect.void,
      testConnection: () => Effect.void,
      signedUrl: () => Effect.die("unused"),
    }),
  ]),
)
let runtime: ManagedRuntime.ManagedRuntime<
  Layer.Success<typeof previewTestLayer>,
  Layer.Error<typeof previewTestLayer>
>
afterEach(async () => {
  native.draining = true
  for (const resolve of native.metadata) resolve()
  for (const output of native.output) output.resolve()
  await runtime.dispose()
  native.metadata.length = 0
  native.output.length = 0
  writes.mockClear()
  native.draining = false
})

test.each(["metadata", "output"] as const)(
  "canceling %s retains native capacity until settlement",
  async (phase) => {
    runtime = ManagedRuntime.make(previewTestLayer)
    const read = Effect.flatMap(FilePreviews, (service) => service.read({ file: previewFile }))
    const first = new AbortController()
    const firstRead = runtime.runPromiseExit(read, { signal: first.signal })
    const secondRead = runtime.runPromise(read)
    await vi.waitFor(() => expect(native.metadata).toHaveLength(2))
    if (phase === "output") {
      native.metadata[0]!()
    }
    await vi.waitFor(() => expect(native.output).toHaveLength(phase === "output" ? 1 : 0))
    first.abort()
    expect((await firstRead)._tag).toBe("Failure")
    const thirdRead = runtime.runPromise(read)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(native.metadata).toHaveLength(2)
    if (phase === "metadata") native.metadata[0]!()
    else native.output[0]!.reject()
    await vi.waitFor(() => expect(native.metadata).toHaveLength(3))
    expect(native.output).toHaveLength(phase === "metadata" ? 0 : 1)
    native.metadata[1]!()
    native.metadata[2]!()
    await vi.waitFor(() => expect(native.output).toHaveLength(phase === "metadata" ? 2 : 3))
    for (const output of native.output) output.resolve()
    expect(await secondRead).toMatchObject({ mimeType: "image/webp" })
    expect(await thirdRead).toMatchObject({ mimeType: "image/webp" })
    expect(writes).toHaveBeenCalledTimes(2)
  },
)

test("canceling queued work never starts a native operation", async () => {
  runtime = ManagedRuntime.make(previewTestLayer)
  const read = Effect.flatMap(FilePreviews, (service) => service.read({ file: previewFile }))
  const active = [runtime.runPromise(read), runtime.runPromise(read)]
  await vi.waitFor(() => expect(native.metadata).toHaveLength(2))
  const canceled = new AbortController()
  const queued = runtime.runPromiseExit(read, { signal: canceled.signal })
  canceled.abort()
  expect((await queued)._tag).toBe("Failure")
  for (const resolve of native.metadata) resolve()
  await vi.waitFor(() => expect(native.output).toHaveLength(2))
  for (const output of native.output) output.resolve()
  await Promise.all(active)
  expect(native.metadata).toHaveLength(2)
})
