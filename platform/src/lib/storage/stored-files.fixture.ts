import { Effect, Layer, ManagedRuntime } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { TestClock } from "effect/testing"

import { Database } from "@/db/database"
import { purgeFileWorkflowLayer } from "@/lib/workflows/purge-file"
import { StoredFiles } from "./stored-files.server"
import { ObjectStorage } from "./object-storage.server"
import { StorageObjectMissing, StorageUnavailable } from "./errors"

export const storedFileFixture = {
  objects: new Map<string, Uint8Array>(),
  failRead: false,
  failDelete: false,
}
const storedFileStorage = ObjectStorage.of({
  put: ({ key, bytes }) =>
    Effect.sync(() => {
      storedFileFixture.objects.set(key, bytes)
    }),
  get: ({ key, maxBytes }) =>
    Effect.gen(function* () {
      if (storedFileFixture.failRead) return yield* new StorageUnavailable()
      const bytes = storedFileFixture.objects.get(key)
      if (!bytes) return yield* new StorageObjectMissing()
      if (bytes.length > maxBytes) return yield* new StorageUnavailable()
      return bytes
    }),
  remove: ({ key }) =>
    Effect.suspend(() =>
      storedFileFixture.failDelete
        ? Effect.fail(new StorageUnavailable())
        : Effect.sync(() => {
            storedFileFixture.objects.delete(key)
          }),
    ),
  head: ({ key }) =>
    Effect.succeed({
      size: storedFileFixture.objects.get(key)?.length ?? 0,
      contentType: "image/png",
    }),
  testConnection: () => Effect.void,
})
const storage = Layer.succeed(ObjectStorage, storedFileStorage)
const storedLayer = StoredFiles.layerNoDeps.pipe(Layer.provideMerge([Database.layer, storage]))
export const storedFilePurgeLayer = purgeFileWorkflowLayer.pipe(
  Layer.provideMerge([storedLayer, WorkflowEngine.layerMemory, TestClock.layer()]),
)
export async function runFilePurge(
  runtime: ManagedRuntime.ManagedRuntime<
    Layer.Success<typeof storedFilePurgeLayer>,
    Layer.Error<typeof storedFilePurgeLayer>
  >,
) {
  await runtime.runPromise(Effect.flatMap(StoredFiles, (files) => files.cleanup))
  for (let step = 0; step < 6; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    await runtime.runPromise(TestClock.adjust("5 minutes"))
  }
}
