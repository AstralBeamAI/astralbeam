import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime, Stream } from "effect"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest"
import { Database, getAuthDatabase } from "@/db/database.server"
import { DatabaseRateLimiter } from "@/db/lib/rate-limiter.server"
import {
  agent,
  organization,
  organizationConfiguration,
  tenant,
  tenantUser,
  fileUpload,
  fileObject,
  fileDeletion,
  multipartDeletion,
} from "@/db/schema.server"
import { ObjectStorage, objectStorageStream } from "@/lib/storage/object-storage.server"
import { MultipartStorage } from "@/lib/storage/multipart-storage.server"
import { StoredFiles } from "@/lib/storage/stored-files.server"
import { StorageUnavailable } from "@/lib/storage/errors"
import { ChatThreads } from "../threads/threads.server"
import type { ChatThreadScope } from "../threads/schemas"
import { ChatFiles } from "./chat-files.server"
import { Uploads } from "./uploads.server"
import { UPLOAD_PART_BYTES } from "./upload-schemas"

const configured =
  process.env.DATABASE_URL !== "postgres://test:test@127.0.0.1:5432/test" &&
  !!process.env.S3_ENDPOINT
if (configured) {
  const url = new URL(process.env.DATABASE_URL!)
  if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_test"))
    throw new Error("Use a disposable loopback database ending in _test")
}
const makeRuntime = () =>
  ManagedRuntime.make(
    Layer.mergeAll(
      Database.layer,
      DatabaseRateLimiter.layer,
      ObjectStorage.layer,
      StoredFiles.layer,
      MultipartStorage.layer,
      ChatFiles.layer,
      ChatThreads.layer,
      Uploads.layer,
    ),
  )

describe.skipIf(!configured)("private multipart uploads with PostgreSQL and S3", () => {
  let runtime: ReturnType<typeof makeRuntime>
  let db: ReturnType<typeof getAuthDatabase>
  let uploads: typeof Uploads.Service
  let scope: ChatThreadScope
  let other: ChatThreadScope
  let foreign: ChatThreadScope
  const bytes = new TextEncoder().encode("A private attachment")
  const input = {
    filename: "note.txt",
    contentType: "text/plain",
    byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }
  const uploadPart = async (id: string, content = bytes, number = 1) => {
    const signed = await runtime.runPromise(uploads.sign(scope, id, [number]))
    const response = await fetch(signed.parts[0]!.url, {
      method: "PUT",
      body: new Uint8Array(content),
    })
    expect(response.ok).toBe(true)
    await response.body?.cancel()
    return signed.parts[0]!.url
  }
  beforeAll(() => {
    db = getAuthDatabase()
  })
  beforeEach(async () => {
    if (runtime) await runtime.dispose()
    runtime = makeRuntime()
    uploads = await runtime.runPromise(Uploads)
    await db.delete(organization)
    const [org] = await db
      .insert(organization)
      .values({ name: "Uploads", slug: "uploads" })
      .returning()
    const organizationId = org!.id
    const [model] = await db
      .insert(agent)
      .values({ organizationId, name: "Assistant", systemPrompt: "Help" })
      .returning()
    await db.insert(organizationConfiguration).values({ organizationId, defaultAgentId: model!.id })
    const tenants = await db
      .insert(tenant)
      .values([
        { organizationId, externalId: "same" },
        { organizationId, externalId: "foreign" },
      ])
      .returning()
    const people = await db
      .insert(tenantUser)
      .values([
        { organizationId, tenantId: tenants[0]!.id, externalId: "owner" },
        { organizationId, tenantId: tenants[0]!.id, externalId: "other" },
        { organizationId, tenantId: tenants[1]!.id, externalId: "owner" },
      ])
      .returning()
    scope = { organizationId, tenantId: tenants[0]!.id, tenantUserId: people[0]!.id }
    other = { ...scope, tenantUserId: people[1]!.id }
    foreign = { organizationId, tenantId: tenants[1]!.id, tenantUserId: people[2]!.id }
  })
  afterAll(async () => {
    await runtime.dispose()
  })

  test("failed multipart preparation frees active slots and records unknown-upload cleanup", async () => {
    const multipart = await runtime.runPromise(MultipartStorage)
    const unavailable = Uploads.layerNoDeps.pipe(
      Layer.provide([
        Database.layer,
        DatabaseRateLimiter.layer,
        ObjectStorage.layer,
        StoredFiles.layer,
        Layer.succeed(MultipartStorage, {
          ...multipart,
          create: () => Effect.fail(new StorageUnavailable()),
        }),
      ]),
    )
    for (let attempt = 0; attempt < 11; attempt++) {
      await expect(
        runtime.runPromise(
          Effect.flatMap(Uploads, (service) => service.prepare(scope, input)).pipe(
            Effect.provide(Layer.fresh(unavailable)),
          ),
        ),
      ).rejects.toMatchObject({ _tag: "ChatThreadStorageUnavailable" })
    }
    expect(await db.select().from(fileUpload)).toHaveLength(0)
    expect(
      (await db.select().from(multipartDeletion)).filter((row) => row.uploadId === null),
    ).toHaveLength(11)
    expect((await runtime.runPromise(uploads.prepare(scope, input))).status).toBe("pending")
  })

  test("bad finalized content becomes cancelled and expired completed drafts report expiry", async () => {
    for (const invalid of [
      { ...input, sha256: "0".repeat(64) },
      { ...input, contentType: "image/png" },
    ]) {
      const session = await runtime.runPromise(uploads.prepare(scope, invalid))
      await uploadPart(session.id)
      await expect(runtime.runPromise(uploads.complete(scope, session.id))).rejects.toMatchObject({
        _tag: "UploadInvalid",
      })
      expect((await runtime.runPromise(uploads.status(scope, session.id))).status).toBe("cancelled")
      const [row] = await db.select().from(fileUpload).where(eq(fileUpload.id, session.id))
      expect(
        await db
          .select()
          .from(multipartDeletion)
          .where(eq(multipartDeletion.objectKey, row!.objectKey)),
      ).toHaveLength(1)
    }
    const session = await runtime.runPromise(uploads.prepare(scope, input))
    await uploadPart(session.id)
    await runtime.runPromise(uploads.complete(scope, session.id))
    await db
      .update(fileUpload)
      .set({ expiresAt: new Date(0) })
      .where(eq(fileUpload.id, session.id))
    expect((await runtime.runPromise(uploads.status(scope, session.id))).status).toBe("expired")
  })

  test("completion verifies immutable final bytes, replays offline and survives restart", async () => {
    const session = await runtime.runPromise(uploads.prepare(scope, input))
    const url = await uploadPart(session.id)
    const complete = await runtime.runPromise(uploads.complete(scope, session.id))
    expect(complete).toMatchObject({
      status: "completed",
      sha256: input.sha256,
      byteSize: bytes.length,
    })
    const [file] = await db.select().from(fileObject).where(eq(fileObject.id, complete.fileId!))
    const [row] = await db.select().from(fileUpload).where(eq(fileUpload.id, session.id))
    expect(file!.objectKey).not.toBe(row!.objectKey)
    const changed = await fetch(url, { method: "PUT", body: new TextEncoder().encode("changed") })
    await changed.body?.cancel()
    const objects = await runtime.runPromise(ObjectStorage)
    expect(
      await runtime.runPromise(objects.get({ key: file!.objectKey, maxBytes: bytes.length })),
    ).toEqual(bytes)
    const streamed = await runtime.runPromise(
      objectStorageStream(file!).pipe(Effect.flatMap(Stream.runCollect)),
    )
    expect(Buffer.concat(streamed.map((chunk) => Buffer.from(chunk)))).toEqual(Buffer.from(bytes))
    let emitted = 0
    await expect(
      runtime.runPromise(
        objectStorageStream({ ...file!, sha256: "0".repeat(64) }).pipe(
          Effect.flatMap((stream) =>
            Stream.runForEach(stream, () =>
              Effect.sync(() => {
                emitted++
              }),
            ),
          ),
        ),
      ),
    ).rejects.toMatchObject({ _tag: "StorageUnavailable" })
    expect(emitted).toBe(0)
    const offline = Uploads.layerNoDeps.pipe(
      Layer.provide(
        Layer.mergeAll(
          Database.layer,
          DatabaseRateLimiter.layer,
          StoredFiles.layer,
          Layer.succeed(ObjectStorage, {} as typeof ObjectStorage.Service),
          Layer.succeed(MultipartStorage, {} as typeof MultipartStorage.Service),
        ),
      ),
    )
    expect(
      await runtime.runPromise(
        Effect.flatMap(Uploads, (service) => service.complete(scope, session.id)).pipe(
          Effect.provide(Layer.fresh(offline)),
        ),
      ),
    ).toEqual(complete)
    await runtime.dispose()
    runtime = makeRuntime()
    uploads = await runtime.runPromise(Uploads)
    expect(await runtime.runPromise(uploads.status(scope, session.id))).toEqual(complete)
    await db.delete(organization).where(eq(organization.id, scope.organizationId))
    expect(await db.select().from(fileObject).where(eq(fileObject.id, file!.id))).toHaveLength(0)
    expect(
      await db.select().from(fileDeletion).where(eq(fileDeletion.objectKey, file!.objectKey)),
    ).toHaveLength(1)
    expect(
      await db
        .select()
        .from(multipartDeletion)
        .where(eq(multipartDeletion.objectKey, row!.objectKey)),
    ).toHaveLength(1)
  })

  test("missing parts recover, wrong bytes fail validation and foreign uploaders cannot substitute files", async () => {
    const session = await runtime.runPromise(uploads.prepare(scope, input))
    await expect(runtime.runPromise(uploads.complete(scope, session.id))).rejects.toMatchObject({
      _tag: "UploadInvalid",
    })
    expect((await runtime.runPromise(uploads.status(scope, session.id))).status).toBe("pending")
    for (const outsider of [other, foreign]) {
      await expect(
        runtime.runPromise(uploads.sign(outsider, session.id, [1])),
      ).rejects.toMatchObject({ _tag: "UploadNotFound" })
      await expect(
        runtime.runPromise(uploads.complete(outsider, session.id)),
      ).rejects.toMatchObject({ _tag: "UploadNotFound" })
    }
    const signed = await runtime.runPromise(uploads.sign(scope, session.id, [1]))
    expect(new URL(signed.parts[0]!.url).searchParams.get("X-Amz-SignedHeaders")).toContain(
      "content-length",
    )
    const oversized = await fetch(signed.parts[0]!.url, {
      method: "PUT",
      body: new Uint8Array(bytes.length + 1),
    })
    expect(oversized.status).toBe(403)
    await oversized.body?.cancel()
    await uploadPart(session.id, new Uint8Array(bytes.length))
    await expect(runtime.runPromise(uploads.complete(scope, session.id))).rejects.toMatchObject({
      _tag: "UploadInvalid",
    })
    await runtime.runPromise(uploads.cancel(scope, session.id))
    await expect(runtime.runPromise(uploads.complete(scope, session.id))).rejects.toMatchObject({
      _tag: "UploadConflict",
    })
  })

  test("completed files are uploader-private until one conversation claims them", async () => {
    const session = await runtime.runPromise(uploads.prepare(scope, input))
    await uploadPart(session.id)
    const finished = await runtime.runPromise(uploads.complete(scope, session.id))
    const threads = await runtime.runPromise(ChatThreads)
    const files = await runtime.runPromise(ChatFiles)
    const first = await runtime.runPromise(threads.create({ scope }))
    const second = await runtime.runPromise(threads.create({ scope }))
    const part = {
      id: crypto.randomUUID(),
      type: "document",
      source: {
        type: "file",
        provider: "astralbeam",
        value: finished.fileId!,
        mimeType: "text/plain",
      },
      metadata: { filename: "note.txt" },
    }
    await expect(
      runtime.runPromise(files.identity({ ...other, threadId: first.id }, [part])),
    ).rejects.toMatchObject({ _tag: "ChatThreadInvalid" })
    await expect(
      runtime.runPromise(files.identity({ ...foreign, threadId: first.id }, [part])),
    ).rejects.toMatchObject({ _tag: "ChatThreadInvalid" })
    await runtime.runPromise(
      threads.admit({ scope, id: first.id, payload: { version: 1, parts: [part] } }),
    )
    await expect(
      runtime.runPromise(
        threads.admit({ scope, id: second.id, payload: { version: 1, parts: [part] } }),
      ),
    ).rejects.toMatchObject({ _tag: "ChatThreadInvalid" })
    await expect(runtime.runPromise(uploads.cancel(scope, session.id))).rejects.toMatchObject({
      _tag: "UploadConflict",
    })
    await db.delete(fileUpload).where(eq(fileUpload.id, session.id))
    expect(
      await db.select().from(fileObject).where(eq(fileObject.id, finished.fileId!)),
    ).toHaveLength(1)
    await db.delete(tenant).where(eq(tenant.id, scope.tenantId))
    expect(
      await db.select().from(fileObject).where(eq(fileObject.id, finished.fileId!)),
    ).toHaveLength(0)
  })

  test("part recovery after restart and expiry retain durable abort targets", async () => {
    const content = new Uint8Array(UPLOAD_PART_BYTES + 1).fill(65)
    const session = await runtime.runPromise(
      uploads.prepare(scope, {
        filename: "data.parquet",
        contentType: "application/vnd.apache.parquet",
        byteSize: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
      }),
    )
    await uploadPart(session.id, content.slice(0, UPLOAD_PART_BYTES))
    const [row] = await db.select().from(fileUpload).where(eq(fileUpload.id, session.id))
    await runtime.dispose()
    runtime = makeRuntime()
    uploads = await runtime.runPromise(Uploads)
    expect((await runtime.runPromise(uploads.status(scope, session.id))).parts).toEqual([
      { number: 1, size: UPLOAD_PART_BYTES },
    ])
    await db
      .update(fileUpload)
      .set({ expiresAt: new Date(0) })
      .where(eq(fileUpload.id, session.id))
    await expect(runtime.runPromise(uploads.sign(scope, session.id, [2]))).rejects.toMatchObject({
      _tag: "UploadConflict",
    })
    await runtime.runPromise(uploads.maintenance)
    expect(await db.select().from(fileUpload).where(eq(fileUpload.id, session.id))).toHaveLength(0)
    const pending = await db
      .select()
      .from(multipartDeletion)
      .where(eq(multipartDeletion.objectKey, row!.objectKey))
    expect(pending).toHaveLength(1)
    await db
      .update(multipartDeletion)
      .set({ retryAt: new Date(0) })
      .where(eq(multipartDeletion.id, pending[0]!.id))
    await runtime.runPromise(uploads.maintenance)
    expect(
      await db.select().from(multipartDeletion).where(eq(multipartDeletion.id, pending[0]!.id)),
    ).toHaveLength(0)
  })

  test("cancellation during final copying cannot publish or claim the file", async () => {
    const session = await runtime.runPromise(uploads.prepare(scope, input))
    await uploadPart(session.id)
    const stored = await runtime.runPromise(StoredFiles)
    let enter: () => void = () => {}
    let release: () => void = () => {}
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const gated = Uploads.layerNoDeps.pipe(
      Layer.provide(
        Layer.mergeAll(
          Database.layer,
          DatabaseRateLimiter.layer,
          ObjectStorage.layer,
          MultipartStorage.layer,
          Layer.succeed(StoredFiles, {
            ...stored,
            prepare: (value) =>
              Effect.promise(() => {
                enter()
                return gate
              }).pipe(Effect.andThen(stored.prepare(value))),
          }),
        ),
      ),
    )
    const completion = runtime.runPromise(
      Effect.flatMap(Uploads, (service) => service.complete(scope, session.id)).pipe(
        Effect.provide(Layer.fresh(gated)),
        Effect.result,
      ),
    )
    await entered
    try {
      await runtime.runPromise(uploads.cancel(scope, session.id))
    } finally {
      release()
    }
    expect(await completion).toMatchObject({ _tag: "Failure", failure: { _tag: "UploadConflict" } })
    expect((await runtime.runPromise(uploads.status(scope, session.id))).status).toBe("cancelled")
    const files = await db
      .select()
      .from(fileObject)
      .where(
        eq(
          fileObject.sourceIdentity,
          `upload:${scope.organizationId}:${scope.tenantId}:${session.id}`,
        ),
      )
    expect(files).toHaveLength(1)
    expect(files[0]!.expiresAt).not.toBeNull()
  })
})
