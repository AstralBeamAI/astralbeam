import { eq } from "drizzle-orm"
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

  test("retries retired files without expiring other uploads", async () => {
    const files = await db
      .insert(fileObject)
      .values(
        (["purging", "pending", "stored"] as const).map((status) => ({
          organizationId,
          objectKey: `files/${crypto.randomUUID()}`,
          contentType: "image/png",
          byteSize: bytes.length,
          sha256: "0".repeat(64),
          createdAt: new Date(0),
          status,
        })),
      )
      .returning()
    for (const file of files) storedFileFixture.objects.set(file.objectKey, bytes)
    const runtime = ManagedRuntime.make(storedFilePurgeLayer)
    const remaining = () =>
      db
        .select()
        .from(fileObject)
        .where(eq(fileObject.organizationId, organizationId))
        .orderBy(fileObject.id)
    try {
      storedFileFixture.failDelete = true
      await runFilePurge(runtime)
      expect(storedFileFixture.objects.size).toBe(3)
      expect(await remaining()).toHaveLength(3)
      storedFileFixture.failDelete = false
      await runFilePurge(runtime)
      expect(storedFileFixture.objects.size).toBe(2)
      expect(await remaining()).toEqual(files.slice(1))
    } finally {
      await runtime.dispose()
    }
  })
})
