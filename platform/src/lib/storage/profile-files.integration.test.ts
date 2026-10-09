import { and, eq, inArray, sql } from "drizzle-orm"
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { betterAuth } from "better-auth/minimal"
import { bearer, organization as organizationPlugin } from "better-auth/plugins"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const fixture = vi.hoisted(() => {
  const configured = process.env.DATABASE_URL
  const url = configured === "postgres://test:test@127.0.0.1:5432/test" ? undefined : configured
  if (url && (new URL(url).hostname !== "127.0.0.1" || !new URL(url).pathname.endsWith("_test")))
    throw new Error("Use a disposable loopback database ending in _test")
  return { url, source: (): Promise<Uint8Array> => Promise.resolve(new Uint8Array()) }
})
import { DatabaseRateLimiter } from "@/db/lib/rate-limiter.server"
import { Database, getAuthDatabase } from "@/db/database.server"
import { session, user } from "@/db/schema/authentication.server"
import { tables } from "@/db/schema.server"
import {
  fileDeletion,
  fileObject,
  organizationImageImport,
  userAvatar,
  userImageImport,
} from "@/db/schema/files.server"
import { member, organization } from "@/db/schema/organizations.server"
import { privateLogoImportField, organizationImageHooks } from "./auth-images.server"
import { ImageSources } from "./image-source.server"
import {
  ImageImportUnavailable,
  ImageSourceMissing,
  StorageObjectMissing,
  StorageUnavailable,
} from "./errors"
import { avatarFileId, verifiedImage } from "./images"
import { ObjectStorage } from "./object-storage.server"
import { ProfileFiles } from "./profile-files.server"
import { StoredFiles } from "./stored-files.server"

const image = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9YQAAAAASUVORK5CYII=",
    "base64",
  ),
)
const embedded = `data:image/png;base64,${Buffer.from(image).toString("base64")}`
const objects = new Map<string, Uint8Array>()
let failRead = false
let failDelete = false
const objectStorage = ObjectStorage.of({
  put: ({ key, bytes }) =>
    Effect.sync(() => {
      objects.set(key, bytes)
    }),
  get: ({ key, maxBytes }) =>
    Effect.gen(function* () {
      if (failRead) return yield* new StorageUnavailable()
      const bytes = objects.get(key)
      if (!bytes) return yield* new StorageObjectMissing()
      if (bytes.length > maxBytes) return yield* new StorageUnavailable()
      return bytes
    }),
  remove: ({ key }) =>
    Effect.suspend(() =>
      failDelete
        ? Effect.fail(new StorageUnavailable())
        : Effect.sync(() => {
            objects.delete(key)
          }),
    ),
  head: ({ key }) =>
    Effect.succeed({ size: objects.get(key)?.length ?? 0, contentType: "image/png" }),
  testConnection: () => Effect.void,
})
const storage = Layer.succeed(ObjectStorage, objectStorage)
const storedLayer = StoredFiles.layerNoDeps.pipe(Layer.provideMerge([Database.layer, storage]))
const profileLayer = ProfileFiles.layerNoDeps.pipe(
  Layer.provideMerge([
    storedLayer,
    DatabaseRateLimiter.layer,
    Layer.succeed(ImageSources, {
      fetch: () =>
        Effect.tryPromise({
          try: () => fixture.source(),
          catch: (error) =>
            error instanceof ImageImportUnavailable || error instanceof ImageSourceMissing
              ? error
              : new ImageSourceMissing({ status: 404 }),
        }).pipe(Effect.flatMap(verifiedImage)),
    }),
  ]),
)
const db = getAuthDatabase()
const userIds: string[] = []
const organizationIds: string[] = []

describe.skipIf(!fixture.url)("profile file lifecycle", () => {
  beforeEach(() => {
    objects.clear()
    failRead = false
    failDelete = false
    fixture.source = () => Promise.resolve(image)
  })
  afterEach(async () => {
    if (userIds.length) await db.delete(user).where(inArray(user.id, userIds.splice(0)))
    if (organizationIds.length)
      await db.delete(organization).where(inArray(organization.id, organizationIds.splice(0)))
    await db.delete(fileObject).where(sql`${fileObject.objectKey} like 'files/%'`)
    await db.delete(fileDeletion).where(sql`${fileDeletion.objectKey} like 'files/%'`)
  })
  async function createProfileFileUser(source: string | null = null) {
    const [owner] = await db
      .insert(user)
      .values({
        name: "Storage fixture",
        email: `${crypto.randomUUID()}@example.com`,
        image: source,
      })
      .returning()
    userIds.push(owner!.id)
    return owner!
  }

  test("refreshes failed preparation metadata but preserves verified content", async () => {
    const runtime = ManagedRuntime.make(storedLayer)
    const sourceIdentity = `recovery:${crypto.randomUUID()}`
    const original = { sourceIdentity, bytes: Uint8Array.of(1), contentType: "image/png" }
    const changed = { sourceIdentity, bytes: Uint8Array.of(2, 3), contentType: "image/jpeg" }
    try {
      failRead = true
      expect(
        await runtime.runPromise(
          Effect.flatMap(StoredFiles, (files) => files.prepare(original)).pipe(Effect.result),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { _tag: "StorageUnavailable" } })
      const [pending] = await db
        .select()
        .from(fileObject)
        .where(eq(fileObject.sourceIdentity, sourceIdentity))
      expect(pending!.verifiedAt).toBeNull()
      failRead = false
      const prepared = await runtime.runPromise(
        Effect.flatMap(StoredFiles, (files) => files.prepare(changed)),
      )
      expect(prepared).toMatchObject({
        id: pending!.id,
        byteSize: 2,
        contentType: "image/jpeg",
      })
      expect(prepared.verifiedAt).toBeInstanceOf(Date)
      expect(prepared.objectKey).not.toBe(pending!.objectKey)
      expect(prepared.sha256).not.toBe(pending!.sha256)
      expect(
        await db.select().from(fileDeletion).where(eq(fileDeletion.objectKey, pending!.objectKey)),
      ).toHaveLength(1)
      expect(
        await runtime.runPromise(
          Effect.flatMap(StoredFiles, (files) => files.prepare(original)).pipe(Effect.result),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { _tag: "StorageUnavailable" } })
      expect(
        (await db.select().from(fileObject).where(eq(fileObject.id, prepared.id)))[0],
      ).toMatchObject({
        objectKey: prepared.objectKey,
        contentType: prepared.contentType,
        byteSize: prepared.byteSize,
        sha256: prepared.sha256,
        verifiedAt: prepared.verifiedAt,
      })
      await db
        .update(fileDeletion)
        .set({ retryAt: new Date(0) })
        .where(eq(fileDeletion.objectKey, pending!.objectKey))
      await runtime.runPromise(Effect.flatMap(StoredFiles, (files) => files.cleanup))
      expect(objects.has(pending!.objectKey)).toBe(false)
      expect(objects.get(prepared.objectKey)).toEqual(changed.bytes)
    } finally {
      await runtime.dispose()
    }
  })

  test.each(["completed", "read failure", "in flight"] as const)(
    "requeues a late superseded upload with cleanup %s",
    async (cleanupState) => {
      const sourceIdentity = `recovery:${crypto.randomUUID()}`
      const original = { sourceIdentity, bytes: Uint8Array.of(1), contentType: "image/png" }
      const changed = { sourceIdentity, bytes: Uint8Array.of(2, 3), contentType: "image/jpeg" }
      const uploadStarted = Promise.withResolvers<void>()
      const releaseUpload = Promise.withResolvers<void>()
      const removeStarted = Promise.withResolvers<void>()
      const releaseRemove = Promise.withResolvers<void>()
      let priorKey: string | undefined
      const delayedStorage = Layer.succeed(ObjectStorage, {
        ...objectStorage,
        put: (input) =>
          Effect.gen(function* () {
            if (input.bytes === original.bytes) {
              uploadStarted.resolve()
              yield* Effect.promise(() => releaseUpload.promise)
            }
            yield* objectStorage.put(input)
          }),
        remove: (input) =>
          Effect.gen(function* () {
            yield* objectStorage.remove(input)
            if (cleanupState === "in flight" && input.key === priorKey) {
              removeStarted.resolve()
              yield* Effect.promise(() => releaseRemove.promise)
            }
          }),
      })
      const runtime = ManagedRuntime.make(
        StoredFiles.layerNoDeps.pipe(Layer.provide([Database.layer, delayedStorage])),
      )
      const stale = runtime.runPromise(
        Effect.flatMap(StoredFiles, (files) => files.prepare(original)).pipe(Effect.result),
      )
      let cleanup: Promise<void> | undefined
      try {
        await uploadStarted.promise
        const [pending] = await db
          .select()
          .from(fileObject)
          .where(eq(fileObject.sourceIdentity, sourceIdentity))
        priorKey = pending!.objectKey
        const prepared = await runtime.runPromise(
          Effect.flatMap(StoredFiles, (files) => files.prepare(changed)),
        )
        expect(prepared.objectKey).not.toBe(pending!.objectKey)
        expect(
          await db
            .select()
            .from(fileDeletion)
            .where(eq(fileDeletion.objectKey, pending!.objectKey)),
        ).toHaveLength(1)
        await db
          .update(fileDeletion)
          .set({ retryAt: new Date(0) })
          .where(eq(fileDeletion.objectKey, pending!.objectKey))
        const [deletion] = await db
          .select()
          .from(fileDeletion)
          .where(eq(fileDeletion.objectKey, priorKey))
        cleanup = runtime.runPromise(Effect.flatMap(StoredFiles, (files) => files.cleanup))
        if (cleanupState === "in flight") await removeStarted.promise
        else await cleanup
        expect(
          await db.select().from(fileDeletion).where(eq(fileDeletion.objectKey, priorKey)),
        ).toHaveLength(cleanupState === "in flight" ? 1 : 0)
        failRead = cleanupState === "read failure"
        releaseUpload.resolve()
        expect(await stale).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "StorageUnavailable" },
        })
        releaseRemove.resolve()
        await cleanup
        expect(
          (await db.select().from(fileObject).where(eq(fileObject.id, prepared.id)))[0],
        ).toEqual(prepared)
        const queued = await db
          .select()
          .from(fileDeletion)
          .where(eq(fileDeletion.objectKey, priorKey))
        expect(queued).toHaveLength(1)
        expect(queued[0]!.id).not.toBe(deletion!.id)
        await db
          .update(fileDeletion)
          .set({ retryAt: new Date(0) })
          .where(eq(fileDeletion.objectKey, pending!.objectKey))
        await runtime.runPromise(Effect.flatMap(StoredFiles, (files) => files.cleanup))
        expect(objects.has(pending!.objectKey)).toBe(false)
        expect(objects.get(prepared.objectKey)).toEqual(changed.bytes)
      } finally {
        releaseUpload.resolve()
        releaseRemove.resolve()
        await stale
        await cleanup
        await runtime.dispose()
      }
    },
  )

  test("keeps source bytes on a failed verification, reuses progress, and reads after restart", async () => {
    const owner = await createProfileFileUser(embedded)
    const runtime = ManagedRuntime.make(profileLayer)
    try {
      failRead = true
      const failed = await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.migrate({ owner: { kind: "avatar", id: owner.id }, source: embedded }),
        ).pipe(Effect.result),
      )
      expect(failed._tag).toBe("Failure")
      expect((await db.select().from(user).where(eq(user.id, owner.id)))[0]!.image).toBe(embedded)
      expect(objects.size).toBe(1)
      failRead = false
      objects.set(Array.from(objects.keys())[0]!, new Uint8Array(image.length + 1))
      expect(
        await runtime.runPromise(
          Effect.flatMap(ProfileFiles, (files) =>
            files.migrate({ owner: { kind: "avatar", id: owner.id }, source: embedded }),
          ),
        ),
      ).toBe("migrated")
      expect(objects.size).toBe(1)
    } finally {
      await runtime.dispose()
    }
    const restarted = ManagedRuntime.make(profileLayer)
    try {
      const [current] = await db.select().from(user).where(eq(user.id, owner.id))
      expect(current!.image).toMatch(/^\/api\/files\/avatars\//)
      expect(current!.avatarFileId).toBe(avatarFileId(current!.image))
      const [file] = await db
        .select()
        .from(fileObject)
        .where(eq(fileObject.id, current!.avatarFileId!))
      expect(file!.expiresAt).toBeNull()
      expect(
        await restarted.runPromise(Effect.flatMap(StoredFiles, (files) => files.read(file!))),
      ).toEqual(image)
      expect(
        await restarted.runPromise(
          Effect.flatMap(ProfileFiles, (files) =>
            files.migrate({ owner: { kind: "avatar", id: owner.id }, source: current!.image }),
          ),
        ),
      ).toBe("unchanged")
    } finally {
      await restarted.dispose()
    }
  })

  test.each(["avatar", "logo"] as const)(
    "only skips migration for a current verified and readable %s reference",
    async (kind) => {
      async function createOwner(source: string) {
        if (kind === "avatar") return (await createProfileFileUser(source)).id
        const [customer] = await db
          .insert(organization)
          .values({ name: "Storage fixture", slug: `storage-${crypto.randomUUID()}`, logo: source })
          .returning()
        organizationIds.push(customer!.id)
        return customer!.id
      }
      const table = kind === "avatar" ? user : organization
      const column = kind === "avatar" ? user.image : organization.logo
      const fileId = kind === "avatar" ? user.avatarFileId : organization.logoFileId
      const migrate = (id: string, source: string) =>
        Effect.flatMap(ProfileFiles, (files) => files.migrate({ owner: { kind, id }, source }))
      const runtime = ManagedRuntime.make(profileLayer)
      try {
        const ownerId = await createOwner(embedded)
        expect(await runtime.runPromise(migrate(ownerId, embedded))).toBe("migrated")
        const [current] = await db
          .select({ source: column, fileId })
          .from(table)
          .where(eq(table.id, ownerId))
        const source = current!.source!
        const [file] = await db.select().from(fileObject).where(eq(fileObject.id, current!.fileId!))
        for (const invalid of [
          "/api/files/legacy.png",
          source.replace(file!.id, "------------------------------------"),
          source.replace(file!.id, "00000000-0000-7000-8000-000000000000"),
          source,
        ]) {
          const invalidOwner = await createOwner(invalid)
          expect(
            await runtime.runPromise(migrate(invalidOwner, invalid).pipe(Effect.result)),
          ).toMatchObject({ _tag: "Failure", failure: { _tag: "InvalidImage" } })
          expect(
            (await db.select({ source: column }).from(table).where(eq(table.id, invalidOwner)))[0]!
              .source,
          ).toBe(invalid)
        }
        for (const metadata of [{ verifiedAt: null }, { expiresAt: new Date() }]) {
          await db.update(fileObject).set(metadata).where(eq(fileObject.id, file!.id))
          expect(
            await runtime.runPromise(migrate(ownerId, source).pipe(Effect.result)),
          ).toMatchObject({ _tag: "Failure", failure: { _tag: "InvalidImage" } })
          await db
            .update(fileObject)
            .set({ verifiedAt: file!.verifiedAt, expiresAt: null })
            .where(eq(fileObject.id, file!.id))
        }
        objects.delete(file!.objectKey)
        expect(
          await runtime.runPromise(migrate(ownerId, source).pipe(Effect.result)),
        ).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "StorageObjectMissing" },
        })
        objects.set(file!.objectKey, new Uint8Array(image.length))
        expect(
          await runtime.runPromise(migrate(ownerId, source).pipe(Effect.result)),
        ).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "StorageUnavailable" },
        })
        objects.set(file!.objectKey, image)
        failRead = true
        expect(
          await runtime.runPromise(migrate(ownerId, source).pipe(Effect.result)),
        ).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "StorageUnavailable" },
        })
        failRead = false
        expect(await runtime.runPromise(migrate(ownerId, source))).toBe("unchanged")
        expect(
          (await db.select({ source: column }).from(table).where(eq(table.id, ownerId)))[0]!.source,
        ).toBe(source)
      } finally {
        await runtime.dispose()
      }
    },
  )

  test("preserves a newer manual avatar when an older import finishes and retains retryable deletion", async () => {
    const owner = await createProfileFileUser()
    const runtime = ManagedRuntime.make(profileLayer)
    let release!: (value: Uint8Array) => void
    let started!: () => void
    const waiting = new Promise<void>((resolve) => {
      started = resolve
    })
    fixture.source = () => {
      started()
      return new Promise((resolve) => {
        release = resolve
      })
    }
    try {
      await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.queueAvatar({
            userId: owner.id,
            email: owner.email,
            source: "https://example.com/avatar.png",
          }),
        ),
      )
      const importing = runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) => files.processImports),
      )
      await waiting
      const manual = await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.uploadAvatar({ userId: owner.id, bytes: image }),
        ),
      )
      await db.update(user).set({ image: manual }).where(eq(user.id, owner.id))
      release(image)
      await importing
      expect((await db.select().from(user).where(eq(user.id, owner.id)))[0]!.image).toBe(manual)
      expect(
        (await db.select().from(userImageImport).where(eq(userImageImport.userId, owner.id)))[0]!
          .status,
      ).toBe("disabled")
      const old = (
        await db
          .select()
          .from(fileObject)
          .where(eq(fileObject.id, avatarFileId(manual)!))
      )[0]!
      await db.delete(user).where(eq(user.id, owner.id))
      expect(await db.select().from(userAvatar).where(eq(userAvatar.userId, owner.id))).toEqual([])
      expect(
        (await db.select().from(fileDeletion).where(eq(fileDeletion.objectKey, old.objectKey)))
          .length,
      ).toBe(1)
      await db.update(fileDeletion).set({ retryAt: new Date(0) })
      failDelete = true
      await runtime.runPromise(Effect.flatMap(StoredFiles, (files) => files.cleanup))
      expect(
        (await db.select().from(fileDeletion).where(eq(fileDeletion.objectKey, old.objectKey)))[0]!
          .attempts,
      ).toBe(1)
      await db.update(fileDeletion).set({ retryAt: new Date(0) })
      failDelete = false
      await runtime.runPromise(Effect.flatMap(StoredFiles, (files) => files.cleanup))
      expect(objects.has(old.objectKey)).toBe(false)
      expect(
        await db.select().from(fileDeletion).where(eq(fileDeletion.objectKey, old.objectKey)),
      ).toEqual([])
    } finally {
      await runtime.dispose()
    }
  })

  test("audits permanently missing images, rejects foreign avatars, and cleans up Organization cascades", async () => {
    const owner = await createProfileFileUser("https://example.com/missing.png")
    const other = await createProfileFileUser()
    const [customer] = await db
      .insert(organization)
      .values({ name: "Storage fixture", slug: `storage-${crypto.randomUUID()}`, logo: embedded })
      .returning()
    organizationIds.push(customer!.id)
    const runtime = ManagedRuntime.make(profileLayer)
    try {
      fixture.source = () => Promise.reject(new Error("404"))
      expect(
        await runtime.runPromise(
          Effect.flatMap(ProfileFiles, (files) =>
            files.migrate({ owner: { kind: "avatar", id: owner.id }, source: owner.image }),
          ),
        ),
      ).toBe("unavailable")
      expect((await db.select().from(user).where(eq(user.id, owner.id)))[0]!.image).toBeNull()
      expect(
        (await db.select().from(userImageImport).where(eq(userImageImport.userId, owner.id)))[0]!
          .status,
      ).toBe("unavailable")
      await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.queueAvatar({ userId: owner.id, email: owner.email, source: owner.image! }),
        ),
      )
      expect(
        (await db.select().from(userImageImport).where(eq(userImageImport.userId, owner.id)))[0]!
          .status,
      ).toBe("pending")
      const avatar = await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.uploadAvatar({ userId: owner.id, bytes: image }),
        ),
      )
      const foreign = await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.validateAvatar({ userId: other.id, image: avatar }),
        ).pipe(Effect.result),
      )
      expect(foreign._tag).toBe("Failure")
      await expect(
        db.update(user).set({ image: avatar }).where(eq(user.id, other.id)),
      ).rejects.toThrow()
      expect(
        await runtime.runPromise(
          Effect.flatMap(ProfileFiles, (files) =>
            files.migrate({ owner: { kind: "logo", id: customer!.id }, source: embedded }),
          ),
        ),
      ).toBe("migrated")
      const generation = crypto.randomUUID()
      await db
        .update(organization)
        .set({ logoImportGeneration: generation })
        .where(eq(organization.id, customer!.id))
      await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.queueLogo({
            organizationId: customer!.id,
            source: "https://example.com/older-logo.png",
            expectedLogo: embedded,
            generation,
          }),
        ),
      )
      expect(
        await db
          .select()
          .from(organizationImageImport)
          .where(eq(organizationImageImport.organizationId, customer!.id)),
      ).toEqual([])
      const [logo] = await db.select().from(organization).where(eq(organization.id, customer!.id))
      const source = "https://example.com/logo.png"
      await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.queueLogo({
            organizationId: customer!.id,
            source,
            expectedLogo: logo!.logo,
            generation,
          }),
        ),
      )
      await db
        .update(organizationImageImport)
        .set({ status: "imported" })
        .where(eq(organizationImageImport.organizationId, customer!.id))
      await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.queueLogo({
            organizationId: customer!.id,
            source,
            expectedLogo: logo!.logo,
            generation,
          }),
        ),
      )
      expect(
        (
          await db
            .select()
            .from(organizationImageImport)
            .where(eq(organizationImageImport.organizationId, customer!.id))
        )[0]!.status,
      ).toBe("pending")
      await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.queueLogo({
            organizationId: customer!.id,
            source,
            expectedLogo: logo!.logo,
            generation,
          }),
        ),
      )
      await expect(
        db.transaction(async (tx) => {
          await tx.update(organization).set({ logo: null }).where(eq(organization.id, customer!.id))
          throw new Error("Rollback logo change")
        }),
      ).rejects.toThrow("Rollback logo change")
      expect(
        (
          await db
            .select()
            .from(organizationImageImport)
            .where(eq(organizationImageImport.organizationId, customer!.id))
        )[0]!.status,
      ).toBe("pending")
      await db.update(organization).set({ logo: null }).where(eq(organization.id, customer!.id))
      await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.queueLogo({
            organizationId: customer!.id,
            source,
            expectedLogo: logo!.logo,
            generation,
          }),
        ),
      )
      expect(
        (
          await db
            .select()
            .from(organizationImageImport)
            .where(eq(organizationImageImport.organizationId, customer!.id))
        )[0]!.status,
      ).toBe("disabled")
      const malformed = await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.validateAvatar({
            userId: owner.id,
            image: "/api/files/avatars/------------------------------------",
          }),
        ).pipe(Effect.result),
      )
      expect(malformed._tag).toBe("Failure")
      await db.update(user).set({ image: avatar }).where(eq(user.id, owner.id))
      await db.delete(userImageImport).where(eq(userImageImport.userId, owner.id))
      await db.update(user).set({ image: null }).where(eq(user.id, owner.id))
      await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.queueAvatar({ userId: owner.id, email: owner.email }),
        ),
      )
      expect(
        (await db.select().from(userImageImport).where(eq(userImageImport.userId, owner.id)))[0]!
          .status,
      ).toBe("disabled")
      const replacementId = await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.prepareLogo({ source: embedded, userId: owner.id }),
        ),
      )
      await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.adoptLogo({ organizationId: customer!.id, fileId: replacementId }),
        ),
      )
      const countBefore = objects.size
      await db.execute(
        sql`update rate_limit set count = 10 where key = ${`effect-rate-limit:profile-upload:${owner.id}`}`,
      )
      const limited = await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.uploadAvatar({ userId: owner.id, bytes: image }),
        ).pipe(Effect.result),
      )
      expect(limited).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "ImageUploadRateLimited" },
      })
      const limitedLogo = await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.prepareLogo({ source: embedded, userId: owner.id }),
        ).pipe(Effect.result),
      )
      expect(limitedLogo).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "ImageUploadRateLimited" },
      })
      expect(objects.size).toBe(countBefore)
      const [file] = await db.select().from(fileObject).where(eq(fileObject.id, replacementId))
      await db.delete(organization).where(eq(organization.id, customer!.id))
      expect(await db.select().from(fileObject).where(eq(fileObject.id, file!.id))).toEqual([])
      expect(
        (await db.select().from(fileDeletion).where(eq(fileDeletion.objectKey, file!.objectKey)))
          .length,
      ).toBe(1)
      expect(
        await db
          .select()
          .from(organizationImageImport)
          .where(and(eq(organizationImageImport.organizationId, customer!.id))),
      ).toEqual([])
    } finally {
      await runtime.dispose()
    }
  })

  test("commits private logo intent with auth updates and recovers it after restart", async () => {
    const owner = await createProfileFileUser()
    const [customer] = await db
      .insert(organization)
      .values({ name: "Logo import", slug: `logo-${crypto.randomUUID()}` })
      .returning()
    const id = customer!.id
    organizationIds.push(id)
    await db.insert(member).values({ organizationId: id, userId: owner.id, role: "owner" })
    const token = crypto.randomUUID()
    await db
      .insert(session)
      .values({ userId: owner.id, token, expiresAt: new Date(Date.now() + 60_000) })
    const [prior] = await db
      .insert(organizationImageImport)
      .values({
        organizationId: id,
        sourceUrl: "https://example.com/prior.png",
        status: "pending",
      })
      .returning()
    const pending = db
      .select()
      .from(organizationImageImport)
      .where(eq(organizationImageImport.organizationId, id))
    const customerRow = db.select().from(organization).where(eq(organization.id, id))
    let rejectUpdate = true
    const auth = betterAuth({
      baseURL: "http://localhost:3000",
      secret: "profile-import-auth-test-secret-long-enough",
      database: drizzleAdapter(db, { provider: "pg", schema: tables }),
      plugins: [
        bearer(),
        organizationPlugin({
          schema: {
            organization: {
              additionalFields: {
                logoImportGeneration: privateLogoImportField,
                logoImportSourceUrl: privateLogoImportField,
              },
            },
          },
          organizationHooks: {
            ...organizationImageHooks,
            beforeUpdateOrganization: async (input) => {
              const result = await organizationImageHooks.beforeUpdateOrganization(input)
              if (rejectUpdate) throw new Error("Rejected organization update")
              return result
            },
          },
        }),
      ],
    })
    const update = () =>
      auth.api.updateOrganization({
        headers: new Headers({ authorization: `Bearer ${token}` }),
        body: {
          organizationId: id,
          data: { name: "Updated logo import", logo: "https://example.com/new.png" },
        },
      })
    await expect(update()).rejects.toThrow("Rejected organization update")
    expect((await pending)[0]).toEqual(prior)
    expect((await customerRow)[0]).toMatchObject({
      name: "Logo import",
      logoImportGeneration: null,
      logoImportSourceUrl: null,
    })
    rejectUpdate = false
    const updated = await update()
    expect(updated).not.toHaveProperty("logoImportGeneration")
    expect(updated).not.toHaveProperty("logoImportSourceUrl")
    const [committed] = await customerRow
    expect(committed).toMatchObject({
      name: "Updated logo import",
      logoImportSourceUrl: "https://example.com/new.png",
    })
    expect(committed!.logoImportGeneration).toEqual(expect.any(String))
    expect((await pending)[0]).toEqual(prior)
    fixture.source = () => Promise.reject(new ImageImportUnavailable())
    const runtime = ManagedRuntime.make(profileLayer)
    try {
      const queue = Effect.flatMap(ProfileFiles, (files) =>
        files.queueLogo({
          organizationId: id,
          source: "https://example.com/new.png",
          expectedLogo: null,
          generation: committed!.logoImportGeneration!,
        }),
      )
      await runtime.runPromise(Effect.flatMap(ProfileFiles, (files) => files.processImports))
      const [queued] = await pending
      expect(queued).toMatchObject({
        status: "pending",
        sourceUrl: "https://example.com/new.png",
        generation: committed!.logoImportGeneration,
      })
      await db.update(organization).set({ logo: null }).where(eq(organization.id, id))
      await db.update(organization).set({ logo: null }).where(eq(organization.id, id))
      await runtime.runPromise(queue)
      expect((await pending)[0]!.status).toBe("disabled")
      expect((await customerRow)[0]!.logoImportSourceUrl).toBeNull()
    } finally {
      await runtime.dispose()
    }
    await update()
    fixture.source = () => Promise.resolve(image)
    const [recommitted] = await customerRow
    const restarted = ManagedRuntime.make(profileLayer)
    try {
      await restarted.runPromise(Effect.flatMap(ProfileFiles, (files) => files.processImports))
      expect((await pending)[0]).toMatchObject({
        status: "imported",
        sourceUrl: "https://example.com/new.png",
        generation: recommitted!.logoImportGeneration,
      })
      const [imported] = await customerRow
      expect(imported!.logo).toMatch(/^\/api\/files\/organizations\//)
      expect(imported!.logoImportSourceUrl).toBeNull()
    } finally {
      await restarted.dispose()
    }
  })

  test("bounds concurrent source failures and retries with backoff before marking them unavailable", async () => {
    const owners = await Promise.all(Array.from({ length: 8 }, () => createProfileFileUser()))
    const selected = inArray(
      userImageImport.userId,
      owners.map((owner) => owner.id),
    )
    const pending = db.select().from(userImageImport).where(selected)
    const runtime = ManagedRuntime.make(profileLayer)
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let active = 0
    let peak = 0
    let calls = 0
    fixture.source = async () => {
      calls += 1
      active += 1
      peak = Math.max(peak, active)
      await gate
      active -= 1
      throw new ImageImportUnavailable()
    }
    try {
      await db.insert(userImageImport).values(
        owners.map((owner) => ({
          userId: owner.id,
          sourceUrl: "https://example.com/retry.png",
          status: "pending" as const,
        })),
      )
      const processing = runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) => files.processImports),
      )
      try {
        await vi.waitFor(() => expect(active).toBe(4))
      } finally {
        release()
      }
      await processing
      expect(peak).toBe(4)
      const first = await pending
      expect(
        first.every(
          (pending) =>
            pending.status === "pending" &&
            pending.attempts === 1 &&
            pending.retryAt.getTime() >= Date.now() + 4 * 60_000,
        ),
      ).toBe(true)
      await db
        .update(userImageImport)
        .set({ retryAt: new Date(0), attempts: 7 })
        .where(selected)
      await runtime.runPromise(Effect.flatMap(ProfileFiles, (files) => files.processImports))
      const exhausted = await pending
      expect(
        exhausted.every((pending) => pending.status === "unavailable" && pending.attempts === 8),
      ).toBe(true)
      await runtime.runPromise(Effect.flatMap(ProfileFiles, (files) => files.processImports))
      expect(calls).toBe(16)
      const owner = owners[0]!
      await db
        .update(userImageImport)
        .set({ status: "pending", attempts: 0, retryAt: new Date(0) })
        .where(eq(userImageImport.userId, owner.id))
      fixture.source = () => Promise.reject(new ImageSourceMissing({ status: 403 }))
      await runtime.runPromise(Effect.flatMap(ProfileFiles, (files) => files.processImports))
      expect(
        (await db.select().from(userImageImport).where(eq(userImageImport.userId, owner.id)))[0],
      ).toMatchObject({ status: "unavailable", reason: "ImageSourceMissing", attempts: 1 })
      await db
        .update(userImageImport)
        .set({ status: "pending", attempts: 7, retryAt: new Date(0) })
        .where(eq(userImageImport.userId, owner.id))
      fixture.source = () => Promise.resolve(image)
      failRead = true
      await runtime.runPromise(Effect.flatMap(ProfileFiles, (files) => files.processImports))
      expect(
        (await db.select().from(userImageImport).where(eq(userImageImport.userId, owner.id)))[0],
      ).toMatchObject({ status: "pending", reason: "StorageUnavailable", attempts: 8 })
    } finally {
      release()
      await runtime.dispose()
    }
  })
})
