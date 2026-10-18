import { eq } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

import { getAuthDatabase } from "@/db/database"
import { organization } from "@/db/schema/organizations"
import { fileObject } from "@/db/schema/files"
import { StoredFiles } from "./stored-files.server"
import { FilePreviews } from "./file-previews.server"
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
let db: ReturnType<typeof getAuthDatabase>
const previewLayer = FilePreviews.layerNoDeps.pipe(Layer.provideMerge(storedFilePurgeLayer))
let runtime: ManagedRuntime.ManagedRuntime<
  Layer.Success<typeof previewLayer>,
  Layer.Error<typeof previewLayer>
>
let organizationId: string
const bytes = Uint8Array.of(1, 2, 3)

describe.skipIf(!databaseUrl)("stored file lifecycle", () => {
  beforeAll(() => {
    db = getAuthDatabase()
  })
  beforeEach(async () => {
    runtime = ManagedRuntime.make(previewLayer)
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
    vi.restoreAllMocks()
    await runtime.dispose()
    await db.delete(organization).where(eq(organization.id, organizationId))
  })
  const rows = () =>
    db
      .select()
      .from(fileObject)
      .where(eq(fileObject.organizationId, organizationId))
      .orderBy(fileObject.id)

  test("only marks verified uploads stored", async () => {
    const upload = Effect.flatMap(StoredFiles, (files) =>
      files.upload({ organizationId, bytes, contentType: "application/octet-stream" }),
    )
    for (const failure of ["failRead", "corruptRead"] as const) {
      storedFileFixture[failure] = true
      expect(await runtime.runPromise(upload.pipe(Effect.result))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "StorageUnavailable" },
      })
      storedFileFixture[failure] = false
    }
    const uploaded = await runtime.runPromise(upload)
    const files = await rows()
    expect(files.filter((file) => file.status === "pending")).toHaveLength(2)
    const stored = files.find((file) => file.id === uploaded.id)!
    expect(stored.status).toBe("stored")
    expect(storedFileFixture.objects.get(stored.objectKey)).toEqual(bytes)
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
    storedFileFixture.objects.set(`${files[0]!.objectKey}.preview.webp`, bytes)
    storedFileFixture.failDelete = true
    await runFilePurge(runtime)
    expect(storedFileFixture.objects.size).toBe(4)
    expect(await rows()).toHaveLength(3)
    storedFileFixture.failDelete = false
    await runFilePurge(runtime)
    expect(storedFileFixture.objects.size).toBe(2)
    expect(await rows()).toEqual(files.slice(1))
  })

  test("caches escaped text beside its source and removes a late thumbnail after retirement", async () => {
    const content = new TextEncoder().encode("<span>& source text")
    await runtime.runPromise(
      Effect.flatMap(StoredFiles, (files) =>
        files.upload({ organizationId, bytes: content, contentType: "text/plain" }),
      ),
    )
    const [source] = await rows()
    const key = `${source!.objectKey}.preview.webp`
    const read = Effect.flatMap(FilePreviews, (service) => service.read({ file: source! }))
    const preview = await runtime.runPromise(read)
    expect(preview?.bytes).toBeInstanceOf(Uint8Array)
    expect(storedFileFixture.objects.get(key)).toEqual(preview!.bytes)
    storedFileFixture.objects.delete(source!.objectKey)
    expect(await runtime.runPromise(read)).toEqual(preview)
    expect(await rows()).toHaveLength(1)
    storedFileFixture.objects.set(source!.objectKey, content)
    storedFileFixture.objects.delete(key)
    const put = storedFileFixture.objects.set.bind(storedFileFixture.objects)
    vi.spyOn(storedFileFixture.objects, "set").mockImplementation((key, bytes) => {
      storedFileFixture.objects.delete(source!.objectKey)
      return put(key, bytes)
    })
    expect(await runtime.runPromise(read)).toBeUndefined()
    expect(storedFileFixture.objects.has(key)).toBe(false)
  })
})
