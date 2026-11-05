import { createHash } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { Duration, Effect, Layer, ManagedRuntime, Schema } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { TestClock } from "effect/testing"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { Database, getAuthDatabase } from "@/db/database"
import { organization, tenant, tenantUser, OrganizationIdSchema } from "@/db/schema/organizations"
import { chatFile, chatThread, chatMessage } from "@/db/schema/chat"
import { fileUpload } from "@/db/schema/uploads"
import { fileObject } from "@/db/schema/files"
import { ObjectStorage } from "@/lib/storage/object-storage.server"
import { MultipartStorage } from "@/lib/storage/multipart-storage.server"
import { StoredFiles } from "@/lib/storage/stored-files.server"
import { StorageObjectMissing, StorageUnavailable, MultipartMissing } from "@/lib/storage/errors"
import uploadCleanup, { uploadCleanupWorkflowLayer } from "@/lib/workflows/upload-cleanup"
import { Uploads } from "./uploads.server"
import type { ChatThreadScope } from "../threads/schemas"

const url = process.env.DATABASE_URL
const configured = url && url !== "postgres://test:test@127.0.0.1:5432/test"
if (
  configured &&
  (new URL(url).hostname !== "127.0.0.1" || !new URL(url).pathname.endsWith("_test"))
)
  throw new Error("Use a disposable loopback database ending in _test")
const objects = new Map<string, Uint8Array>()
const staging = new Map<string, { key: string; bytes?: Uint8Array }>()
const fixture = {
  failStorage: false,
  failCleanup: false,
  put: undefined as (() => Promise<void>) | undefined,
}
const objectLayer = Layer.succeed(ObjectStorage, {
  put: ({ key, bytes }) =>
    Effect.gen(function* () {
      if (fixture.put) yield* Effect.promise(fixture.put)
      objects.set(key, bytes)
    }),
  get: ({ key }) =>
    fixture.failStorage
      ? Effect.fail(new StorageUnavailable())
      : objects.has(key)
        ? Effect.succeed(objects.get(key)!)
        : Effect.fail(new StorageObjectMissing()),
  head: ({ key }) =>
    objects.has(key)
      ? Effect.succeed({ size: objects.get(key)!.length, contentType: "text/plain" })
      : Effect.fail(new StorageObjectMissing()),
  remove: ({ key }) =>
    fixture.failCleanup
      ? Effect.fail(new StorageUnavailable())
      : Effect.sync(() => {
          objects.delete(key)
        }),
  signedUrl: () => Effect.die("unused"),
  testConnection: () => Effect.die("unused"),
})
const multipartLayer = Layer.succeed(MultipartStorage, {
  create: (key) =>
    Effect.sync(() => {
      const id = crypto.randomUUID()
      staging.set(id, { key })
      return id
    }),
  list: (_key, id) =>
    staging.has(id)
      ? Effect.succeed(
          staging.get(id)!.bytes
            ? [{ number: 1, size: staging.get(id)!.bytes!.length, etag: "verified-part" }]
            : [],
        )
      : Effect.fail(new MultipartMissing()),
  sign: (_key, id) => Effect.succeed(`https://storage.example/${id}`),
  complete: (key, id) =>
    staging.has(id)
      ? Effect.sync(() => {
          objects.set(key, staging.get(id)!.bytes!)
          staging.delete(id)
        })
      : Effect.fail(new MultipartMissing()),
  abort: (_key, id) =>
    fixture.failCleanup
      ? Effect.fail(new StorageUnavailable())
      : Effect.sync(() => {
          staging.delete(id)
        }),
  find: (key) =>
    Effect.succeed([...staging].filter(([, value]) => value.key === key).map(([id]) => id)),
})
const services = Layer.mergeAll(Database.layer, objectLayer, multipartLayer)
const files = StoredFiles.layerNoDeps.pipe(Layer.provide(services))
const scheduled = new Map<string, Effect.Effect<unknown, unknown>>()
// Model the durable runner boundary: dispatch happens after the producer transaction commits.
const engine = Layer.effect(
  WorkflowEngine.WorkflowEngine,
  Effect.gen(function* () {
    const memory = yield* WorkflowEngine.WorkflowEngine
    return {
      ...memory,
      execute: (_workflow, options) =>
        Effect.sync(() => {
          scheduled.set(
            options.executionId,
            memory.execute(uploadCleanup, {
              executionId: options.executionId,
              payload: Schema.decodeUnknownSync(uploadCleanup.payloadSchema)(options.payload),
              discard: true,
            }),
          )
          return options.executionId
        }),
    }
  }),
).pipe(Layer.provideMerge(WorkflowEngine.layerMemory.pipe(Layer.provideMerge(TestClock.layer()))))
const layer = Layer.mergeAll(Uploads.layerNoDeps, uploadCleanupWorkflowLayer).pipe(
  Layer.provideMerge([services, files, engine]),
)
const bytes = new TextEncoder().encode("private attachment")
const input = {
  filename: "note.txt",
  contentType: "text/plain",
  byteSize: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
}
const db = getAuthDatabase()

describe.skipIf(!configured)("private multipart upload lifecycle", () => {
  let runtime: ManagedRuntime.ManagedRuntime<Layer.Success<typeof layer>, Layer.Error<typeof layer>>
  let uploads: typeof Uploads.Service
  let scope: ChatThreadScope
  let other: ChatThreadScope
  beforeEach(async () => {
    objects.clear()
    staging.clear()
    scheduled.clear()
    fixture.failStorage = false
    fixture.failCleanup = false
    fixture.put = undefined
    runtime = ManagedRuntime.make(layer)
    uploads = await runtime.runPromise(Uploads)
    const [org] = await db
      .insert(organization)
      .values({ domain: "example.com", name: "Uploads", slug: `uploads-${crypto.randomUUID()}` })
      .returning()
    const organizationId = OrganizationIdSchema.make(org!.id)
    const tenants = await db
      .insert(tenant)
      .values([
        { organizationId, externalId: "one" },
        { organizationId, externalId: "two" },
      ])
      .returning()
    const people = await db
      .insert(tenantUser)
      .values(
        tenants.map((item) => ({
          organizationId,
          tenantId: item.id,
          externalId: "uploader",
        })),
      )
      .returning()
    scope = { organizationId, tenantId: tenants[0]!.id, tenantUserId: people[0]!.id }
    other = { organizationId, tenantId: tenants[1]!.id, tenantUserId: people[1]!.id }
  })
  afterEach(async () => {
    await runtime.dispose()
    await db.delete(organization).where(eq(organization.id, scope.organizationId))
  })
  const prepare = (key = crypto.randomUUID()) =>
    runtime.runPromise(uploads.prepare(scope, { ...input, prepareKey: key }))
  const row = async (id: string) =>
    (
      await db
        .select()
        .from(fileUpload)
        .where(and(eq(fileUpload.organizationId, scope.organizationId), eq(fileUpload.id, id)))
    )[0]!
  const sendPart = async (id: string, content = bytes) => {
    const saved = await row(id)
    staging.get(saved.uploadId!)!.bytes = content
  }
  const advance = async (duration: Duration.Input) => {
    for (const effect of scheduled.values()) await runtime.runPromise(effect)
    scheduled.clear()
    await new Promise((resolve) => setTimeout(resolve, 30))
    await runtime.runPromise(TestClock.adjust(duration))
    await new Promise((resolve) => setTimeout(resolve, 30))
  }

  test("replays preparation and refuses changed content, foreign users and excess active uploads", async () => {
    const key = crypto.randomUUID()
    const first = await prepare(key)
    expect((await prepare(key)).id).toBe(first.id)
    expect(
      await runtime.runPromise(
        uploads
          .prepare(scope, { ...input, prepareKey: key, filename: "changed.txt" })
          .pipe(Effect.result),
      ),
    ).toMatchObject({ _tag: "Failure", failure: { _tag: "UploadConflict" } })
    expect(
      await runtime.runPromise(uploads.status(other, first.id).pipe(Effect.result)),
    ).toMatchObject({ _tag: "Failure", failure: { _tag: "UploadNotFound" } })
    expect(
      await runtime.runPromise(
        uploads
          .status(
            {
              ...scope,
              tenantUserId: (
                await db
                  .insert(tenantUser)
                  .values({
                    organizationId: scope.organizationId,
                    tenantId: scope.tenantId,
                    externalId: "colleague",
                  })
                  .returning()
              )[0]!.id,
            },
            first.id,
          )
          .pipe(Effect.result),
      ),
    ).toMatchObject({ _tag: "Failure", failure: { _tag: "UploadNotFound" } })
    for (let index = 0; index < 9; index++) await prepare()
    expect(
      await runtime.runPromise(uploads.prepare(scope, input).pipe(Effect.result)),
    ).toMatchObject({ _tag: "Failure", failure: { _tag: "UploadRateLimited" } })
    expect((await prepare(key)).id).toBe(first.id)
  })
  test("an incomplete completion remains retryable and invalid media never becomes stored", async () => {
    const session = await prepare()
    expect(
      await runtime.runPromise(uploads.complete(scope, session.id).pipe(Effect.result)),
    ).toMatchObject({ _tag: "Failure", failure: { _tag: "UploadInvalid" } })
    expect((await row(session.id)).status).toBe("pending")
    expect((await runtime.runPromise(uploads.sign(scope, session.id, [1]))).parts).toHaveLength(1)
    await sendPart(session.id)
    expect((await runtime.runPromise(uploads.complete(scope, session.id))).status).toBe("completed")
    const invalid = await runtime.runPromise(
      uploads.prepare(scope, { ...input, filename: "invalid.png", contentType: "image/png" }),
    )
    await sendPart(invalid.id)
    expect(
      await runtime.runPromise(uploads.complete(scope, invalid.id).pipe(Effect.result)),
    ).toMatchObject({ _tag: "Failure", failure: { _tag: "UploadInvalid" } })
    expect((await row(invalid.id)).status).toBe("cancelled")
  })
  test("cancellation fences a preparation that arrives later", async () => {
    const key = crypto.randomUUID()
    await runtime.runPromise(uploads.cancelPrepared(scope, key))
    expect(
      await runtime.runPromise(
        uploads.prepare(scope, { ...input, prepareKey: key }).pipe(Effect.result),
      ),
    ).toMatchObject({ _tag: "Failure", failure: { _tag: "UploadConflict" } })
    expect(staging.size).toBe(0)
  })
  test("recovers a stranded preparation with a new staging key and cleans the older upload", async () => {
    const key = crypto.randomUUID()
    const session = await prepare(key)
    const previous = await row(session.id)
    await db
      .update(fileUpload)
      .set({ status: "preparing", uploadId: null, updatedAt: new Date(0) })
      .where(eq(fileUpload.id, session.id))
    const recovered = await prepare(key)
    expect(recovered.id).toBe(session.id)
    const current = await row(session.id)
    expect(current.objectKey).not.toBe(previous.objectKey)
    await advance("2 minutes")
    expect(staging.has(previous.uploadId!)).toBe(false)
    expect(staging.has(current.uploadId!)).toBe(true)
    expect((await row(session.id)).status).toBe("pending")
  })
  test("verifies immutable final bytes and keeps completed files after session expiry", async () => {
    const session = await prepare()
    const staged = await row(session.id)
    await sendPart(session.id)
    const completed = await runtime.runPromise(uploads.complete(scope, session.id))
    const [file] = await db.select().from(fileObject).where(eq(fileObject.id, completed.fileId!))
    expect(file!.status).toBe("stored")
    expect(file!.objectKey).not.toBe(staged.objectKey)
    objects.set(staged.objectKey, new Uint8Array([0]))
    expect(objects.get(file!.objectKey)).toEqual(bytes)
    await db
      .update(fileUpload)
      .set({ expiresAt: new Date(0) })
      .where(eq(fileUpload.id, session.id))
    fixture.failStorage = true
    expect((await runtime.runPromise(uploads.complete(scope, session.id))).fileId).toBe(
      completed.fileId,
    )
    expect((await runtime.runPromise(uploads.status(scope, session.id))).status).toBe("completed")
    await advance("25 hours")
    expect((await db.select().from(fileObject).where(eq(fileObject.id, file!.id)))[0]!.status).toBe(
      "stored",
    )
  })
  test("rejects invalid content and retries physical staging cleanup after provider failure", async () => {
    const session = await prepare()
    await sendPart(session.id, new Uint8Array(bytes.length))
    const staged = await row(session.id)
    expect(
      await runtime.runPromise(uploads.complete(scope, session.id).pipe(Effect.result)),
    ).toMatchObject({ _tag: "Failure", failure: { _tag: "UploadInvalid" } })
    expect((await row(session.id)).status).toBe("cancelled")
    fixture.failCleanup = true
    await advance("2 minutes")
    expect(objects.has(staged.objectKey)).toBe(true)
    fixture.failCleanup = false
    await advance("6 minutes")
    expect(objects.has(staged.objectKey)).toBe(false)
    const [file] = await db.select().from(fileObject).where(eq(fileObject.id, staged.fileId))
    expect(file!.status).toBe("purging")
  })
  test("does not publish a completion that loses to cancellation", async () => {
    const session = await prepare()
    await sendPart(session.id)
    let release!: () => void
    let reached!: () => void
    const waiting = new Promise<void>((resolve) => {
      reached = resolve
    })
    fixture.put = () =>
      new Promise<void>((resolve) => {
        release = resolve
        reached()
      })
    const completion = runtime.runPromise(uploads.complete(scope, session.id).pipe(Effect.result))
    await waiting
    await runtime.runPromise(uploads.cancel(scope, session.id))
    release()
    expect(await completion).toMatchObject({ _tag: "Failure", failure: { _tag: "UploadConflict" } })
    expect((await row(session.id)).status).toBe("cancelled")
  })
  test("protects a claimed file and retains its replayable completion", async () => {
    const session = await prepare()
    await sendPart(session.id)
    const completed = await runtime.runPromise(uploads.complete(scope, session.id))
    const [thread] = await db
      .insert(chatThread)
      .values({ organizationId: scope.organizationId, tenantId: scope.tenantId })
      .returning()
    const [message] = await db
      .insert(chatMessage)
      .values({
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        threadId: thread!.id,
        authorTenantUserId: scope.tenantUserId,
        role: "user",
        state: "complete",
        turnState: "completed",
        metadata: { version: 1 },
      })
      .returning()
    await db
      .update(chatFile)
      .set({ threadId: thread!.id, messageId: message!.id })
      .where(eq(chatFile.fileObjectId, completed.fileId!))
    expect(
      await runtime.runPromise(uploads.cancel(scope, session.id).pipe(Effect.result)),
    ).toMatchObject({ _tag: "Failure", failure: { _tag: "UploadClaimed" } })
    expect((await runtime.runPromise(uploads.status(scope, session.id))).claimed).toBe(true)
    fixture.failStorage = true
    expect((await runtime.runPromise(uploads.complete(scope, session.id))).fileId).toBe(
      completed.fileId,
    )
  })
  test("staging cleanup survives populated Organization deletion", async () => {
    const session = await prepare()
    const staged = await row(session.id)
    await db.delete(organization).where(eq(organization.id, scope.organizationId))
    expect(staging.has(staged.uploadId!)).toBe(true)
    await advance("25 hours")
    expect(staging.has(staged.uploadId!)).toBe(false)
  })
})
