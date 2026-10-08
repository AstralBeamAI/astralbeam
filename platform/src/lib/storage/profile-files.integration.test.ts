import { and, eq, inArray, sql } from "drizzle-orm"
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
import { user } from "@/db/schema/authentication.server"
import {
  fileDeletion,
  fileObject,
  organizationImageImport,
  userAvatar,
  userImageImport,
} from "@/db/schema/files.server"
import { organization } from "@/db/schema/organizations.server"
import { ImageSources } from "./image-source.server"
import { ImageSourceMissing, StorageObjectMissing, StorageUnavailable } from "./errors"
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
const storage = Layer.succeed(ObjectStorage, {
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
const storedLayer = StoredFiles.layerNoDeps.pipe(Layer.provideMerge([Database.layer, storage]))
const profileLayer = ProfileFiles.layerNoDeps.pipe(
  Layer.provideMerge([
    storedLayer,
    DatabaseRateLimiter.layer,
    Layer.succeed(ImageSources, {
      fetch: () =>
        Effect.tryPromise({
          try: () => fixture.source(),
          catch: () => new ImageSourceMissing({ status: 404 }),
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

  test("keeps source bytes on a failed verification, reuses progress, and reads after restart", async () => {
    const owner = await createProfileFileUser(embedded)
    const runtime = ManagedRuntime.make(profileLayer)
    try {
      failRead = true
      const failed = await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.migrate({ kind: "avatar", id: owner.id }, embedded),
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
            files.migrate({ kind: "avatar", id: owner.id }, embedded),
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
            files.migrate({ kind: "avatar", id: owner.id }, current!.image),
          ),
        ),
      ).toBe("unchanged")
    } finally {
      await restarted.dispose()
    }
  })

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
        Effect.flatMap(ProfileFiles, (files) => files.uploadAvatar(owner.id, image)),
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
            files.migrate({ kind: "avatar", id: owner.id }, owner.image),
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
        Effect.flatMap(ProfileFiles, (files) => files.uploadAvatar(owner.id, image)),
      )
      const foreign = await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) => files.validateAvatar(other.id, avatar)).pipe(
          Effect.result,
        ),
      )
      expect(foreign._tag).toBe("Failure")
      await expect(
        db.update(user).set({ image: avatar }).where(eq(user.id, other.id)),
      ).rejects.toThrow()
      expect(
        await runtime.runPromise(
          Effect.flatMap(ProfileFiles, (files) =>
            files.migrate({ kind: "logo", id: customer!.id }, embedded),
          ),
        ),
      ).toBe("migrated")
      await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.queueLogo(customer!.id, "https://example.com/older-logo.png", embedded),
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
        Effect.flatMap(ProfileFiles, (files) => files.queueLogo(customer!.id, source, logo!.logo)),
      )
      await db
        .update(organizationImageImport)
        .set({ status: "imported" })
        .where(eq(organizationImageImport.organizationId, customer!.id))
      await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) => files.queueLogo(customer!.id, source, logo!.logo)),
      )
      expect(
        (
          await db
            .select()
            .from(organizationImageImport)
            .where(eq(organizationImageImport.organizationId, customer!.id))
        )[0]!.status,
      ).toBe("pending")
      const generation = await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) => files.stageLogo(customer!.id, source)),
      )
      await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.queueLogo(customer!.id, source, logo!.logo, generation),
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
          files.queueLogo(customer!.id, source, logo!.logo, generation),
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
          files.validateAvatar(owner.id, "/api/files/avatars/------------------------------------"),
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
        Effect.flatMap(ProfileFiles, (files) => files.prepareLogo(embedded, owner.id)),
      )
      await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) => files.adoptLogo(customer!.id, replacementId)),
      )
      const countBefore = objects.size
      await db.execute(
        sql`update rate_limit set count = 10 where key = ${`effect-rate-limit:profile-upload:${owner.id}`}`,
      )
      const limited = await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) => files.uploadAvatar(owner.id, image)).pipe(
          Effect.result,
        ),
      )
      expect(limited).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "ImageUploadRateLimited" },
      })
      const limitedLogo = await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) => files.prepareLogo(embedded, owner.id)).pipe(
          Effect.result,
        ),
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
})
