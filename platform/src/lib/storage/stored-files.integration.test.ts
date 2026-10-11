import { eq, inArray, sql } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { TestClock } from "effect/testing"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

import { Database, getAuthDatabase } from "@/db/database"
import { fileObject } from "@/db/schema/files"
import { StoredFiles } from "./stored-files.server"
import { purgeFileWorkflowLayer } from "@/lib/workflows/purge-file"
import { ObjectStorage } from "./object-storage.server"
import { StorageObjectMissing, StorageUnavailable } from "./errors"

const configured = process.env.DATABASE_URL
const databaseUrl =
  configured === "postgres://test:test@127.0.0.1:5432/test" ? undefined : configured
if (
  databaseUrl &&
  (new URL(databaseUrl).hostname !== "127.0.0.1" ||
    !new URL(databaseUrl).pathname.endsWith("_test"))
)
  throw new Error("Use a disposable loopback database ending in _test")
const db = getAuthDatabase()
const bytes = Uint8Array.of(1, 2, 3)

const storedFileFixture = {
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
const storedFilePurgeLayer = purgeFileWorkflowLayer.pipe(
  Layer.provideMerge([storedLayer, WorkflowEngine.layerMemory, TestClock.layer()]),
)
async function runFilePurge(
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

describe.skipIf(!databaseUrl)("stored file lifecycle", () => {
  beforeEach(() => {
    storedFileFixture.objects.clear()
    storedFileFixture.failRead = false
    storedFileFixture.failDelete = false
  })
  afterEach(async () => {
    await db.delete(fileObject).where(sql`${fileObject.objectKey} like 'files/%'`)
  })
  test("retries with a new file and verifies saved content after restart", async () => {
    const runtime = ManagedRuntime.make(storedFilePurgeLayer)
    let file: typeof fileObject.$inferSelect
    try {
      storedFileFixture.failRead = true
      expect(
        await runtime.runPromise(
          Effect.flatMap(StoredFiles, (files) =>
            files.upload({ bytes, contentType: "application/octet-stream" }),
          ).pipe(Effect.result),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { _tag: "StorageUnavailable" } })
      const [failed] = await db.select().from(fileObject).where(eq(fileObject.status, "pending"))
      storedFileFixture.failRead = false
      const uploaded = await runtime.runPromise(
        Effect.flatMap(StoredFiles, (files) =>
          files.upload({ bytes, contentType: "application/octet-stream" }),
        ),
      )
      file = (await db.select().from(fileObject).where(eq(fileObject.id, uploaded.id)))[0]!
      expect(file.objectKey).not.toBe(failed!.objectKey)
      expect(file.status).toBe("stored")
      expect((await db.select().from(fileObject).where(eq(fileObject.id, failed!.id)))[0]).toEqual(
        failed,
      )
    } finally {
      await runtime.dispose()
    }
    const restarted = ManagedRuntime.make(storedFilePurgeLayer)
    try {
      expect(
        await restarted.runPromise(Effect.flatMap(StoredFiles, (files) => files.read(file))),
      ).toEqual(bytes)
      storedFileFixture.objects.set(file.objectKey, Uint8Array.of(3, 2, 1))
      expect(
        await restarted.runPromise(
          Effect.flatMap(StoredFiles, (files) => files.read(file)).pipe(Effect.result),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { _tag: "StorageUnavailable" } })
    } finally {
      await restarted.dispose()
    }
  })

  test("reclaims unfinished and unattached stored uploads after restart and retries deletion", async () => {
    const pending = await db
      .insert(fileObject)
      .values(
        Array.from({ length: 5 }, (_, index) => ({
          objectKey: `files/${crypto.randomUUID()}`,
          contentType: "image/png",
          byteSize: bytes.length,
          sha256: "0".repeat(64),
          createdAt: new Date(0),
          status: index === 0 ? ("stored" as const) : ("pending" as const),
        })),
      )
      .returning()
    const pendingIds = pending.map((file) => file.id)
    const protectedFiles = await db
      .insert(fileObject)
      .values([
        {
          objectKey: `files/${crypto.randomUUID()}`,
          contentType: "image/png",
          byteSize: 3,
          sha256: "0".repeat(64),
        },
        {
          objectKey: `files/${crypto.randomUUID()}`,
          contentType: "image/png",
          byteSize: 3,
          sha256: "0".repeat(64),
          status: "stored",
        },
      ])
      .returning()
    for (const file of pending) storedFileFixture.objects.set(file.objectKey, bytes)
    const interrupted = ManagedRuntime.make(storedFilePurgeLayer)
    try {
      expect(
        await interrupted.runPromise(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine
            yield* (yield* StoredFiles).cleanup.pipe(
              Effect.provideService(WorkflowEngine.WorkflowEngine, {
                ...engine,
                execute: () => Effect.die("runner unavailable"),
              }),
            )
          }).pipe(Effect.exit),
        ),
      ).toMatchObject({ _tag: "Failure" })
      expect(
        (await db.select().from(fileObject).where(eq(fileObject.id, pending[0]!.id)))[0]!.status,
      ).toBe("purging")
    } finally {
      await interrupted.dispose()
    }
    const runtime = ManagedRuntime.make(storedFilePurgeLayer)
    try {
      storedFileFixture.failDelete = true
      await runFilePurge(runtime)
      expect(storedFileFixture.objects.size).toBe(5)
      expect(
        await db.select().from(fileObject).where(inArray(fileObject.id, pendingIds)),
      ).toHaveLength(5)
      storedFileFixture.failDelete = false
      await runFilePurge(runtime)
      expect(storedFileFixture.objects.size).toBe(0)
      expect(await db.select().from(fileObject).where(inArray(fileObject.id, pendingIds))).toEqual(
        [],
      )
      expect(
        await db
          .select()
          .from(fileObject)
          .where(
            inArray(
              fileObject.id,
              protectedFiles.map((file) => file.id),
            ),
          )
          .orderBy(fileObject.id),
      ).toEqual(protectedFiles)
    } finally {
      await runtime.dispose()
    }
  })
})
