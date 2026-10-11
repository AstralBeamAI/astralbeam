import { eq, inArray } from "drizzle-orm"
import { Effect, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

import { getAuthDatabase } from "@/db/database"
import { organization } from "@/db/schema/organizations"
import { fileObject } from "@/db/schema/files"
import { StoredFiles } from "./stored-files.server"
import { storedFileFixture, storedFilePurgeLayer, runFilePurge } from "./stored-files.fixture"

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
let organizationId: string
const bytes = Uint8Array.of(1, 2, 3)

describe.skipIf(!databaseUrl)("stored file lifecycle", () => {
  beforeEach(async () => {
    const [owner] = await db
      .insert(organization)
      .values({ name: "Files", slug: `files-${crypto.randomUUID()}` })
      .returning()
    organizationId = owner!.id
    storedFileFixture.objects.clear()
    storedFileFixture.failRead = false
    storedFileFixture.corruptRead = false
    storedFileFixture.failDelete = false
  })
  afterEach(async () => {
    await db.delete(organization).where(eq(organization.id, organizationId))
  })
  test("only marks verified uploads stored", async () => {
    const runtime = ManagedRuntime.make(storedFilePurgeLayer)
    const upload = Effect.flatMap(StoredFiles, (files) =>
      files.upload({ organizationId, bytes, contentType: "application/octet-stream" }),
    )
    try {
      for (const failure of ["failRead", "corruptRead"] as const) {
        storedFileFixture[failure] = true
        expect(await runtime.runPromise(upload.pipe(Effect.result))).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "StorageUnavailable" },
        })
        storedFileFixture[failure] = false
      }
      const uploaded = await runtime.runPromise(upload)
      const files = await db
        .select()
        .from(fileObject)
        .where(eq(fileObject.organizationId, organizationId))
      expect(files.filter((file) => file.status === "pending")).toHaveLength(2)
      const stored = files.find((file) => file.id === uploaded.id)!
      expect(stored.status).toBe("stored")
      expect(storedFileFixture.objects.get(stored.objectKey)).toEqual(bytes)
    } finally {
      await runtime.dispose()
    }
  })

  test("reclaims unfinished and retired uploads and retries deletion", async () => {
    const pending = await db
      .insert(fileObject)
      .values(
        Array.from({ length: 2 }, (_, index) => ({
          organizationId,
          objectKey: `files/${crypto.randomUUID()}`,
          contentType: "image/png",
          byteSize: bytes.length,
          sha256: "0".repeat(64),
          createdAt: new Date(0),
          status: index === 0 ? ("purging" as const) : ("pending" as const),
        })),
      )
      .returning()
    const pendingIds = pending.map((file) => file.id)
    const protectedFiles = await db
      .insert(fileObject)
      .values([
        {
          organizationId,
          objectKey: `files/${crypto.randomUUID()}`,
          contentType: "image/png",
          byteSize: 3,
          sha256: "0".repeat(64),
        },
        {
          organizationId,
          objectKey: `files/${crypto.randomUUID()}`,
          contentType: "image/png",
          byteSize: 3,
          sha256: "0".repeat(64),
          status: "stored",
          createdAt: new Date(0),
        },
      ])
      .returning()
    for (const file of pending) storedFileFixture.objects.set(file.objectKey, bytes)
    const runtime = ManagedRuntime.make(storedFilePurgeLayer)
    try {
      storedFileFixture.failDelete = true
      await runFilePurge(runtime)
      expect(storedFileFixture.objects.size).toBe(2)
      expect(
        await db.select().from(fileObject).where(inArray(fileObject.id, pendingIds)),
      ).toHaveLength(2)
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
