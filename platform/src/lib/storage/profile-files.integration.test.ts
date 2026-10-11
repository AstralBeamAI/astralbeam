import { createHash } from "node:crypto"
import { verifiedImage } from "./image-validation.server"
import { eq, inArray, sql } from "drizzle-orm"
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
  return {
    url,
    run: undefined as
      | (<A, E>(
          effect: Effect.Effect<A, E, ProfileFiles | WorkflowEngine.WorkflowEngine>,
        ) => Promise<A>)
      | undefined,
    source: (_source: string): Promise<Uint8Array> => Promise.resolve(new Uint8Array()),
  }
})
import { DatabaseRateLimiter } from "@/db/lib/rate-limiter"
import { getAuthDatabase } from "@/db/database"
import { session, user } from "@/db/schema/authentication"
import { tables } from "@/db/schema"
import { fileObject } from "@/db/schema/files"
import { member, organization } from "@/db/schema/organizations"
import fileMaintenance from "@/lib/workflows/file-maintenance"
import { gravatarHooks, privateLogoImportField, organizationImageHooks } from "./auth-images.server"
import { ImageSources } from "./image-source.server"
import { ImageImportUnavailable, ImageSourceMissing } from "./errors"
import { avatarFileId } from "./images"
import profileImageImport, {
  profileImageImportWorkflowLayer,
} from "@/lib/workflows/profile-image-import"
import { WorkflowEngine } from "effect/workflow"
import { ProfileFiles } from "./profile-files.server"
import { StoredFiles } from "./stored-files.server"
import { storedFileFixture, storedFilePurgeLayer, runFilePurge } from "./stored-files.fixture"

vi.mock("@/lib/cluster/runtime", () => ({
  provideClusterWorkflowEngine: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
}))
vi.mock("@/lib/runtime/app-effect.server", () => ({
  runAppEffect: <A, E>(effect: Effect.Effect<A, E, ProfileFiles | WorkflowEngine.WorkflowEngine>) =>
    fixture.run!(effect),
}))
const emailHash = (email: string) =>
  createHash("sha256").update(email.trim().toLowerCase()).digest("hex")

const image = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP438AAAAQBAYCQNzXrAAAAAElFTkSuQmCC",
    "base64",
  ),
)
const embedded = `data:image/png;base64,${Buffer.from(image).toString("base64")}`
const profileLayer = ProfileFiles.layerNoDeps.pipe(
  Layer.provideMerge([
    storedFilePurgeLayer,
    DatabaseRateLimiter.layer,
    Layer.succeed(ImageSources, {
      fetch: ({ source }) =>
        Effect.tryPromise({
          try: () => fixture.source(source),
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
    storedFileFixture.objects.clear()
    storedFileFixture.failRead = false
    storedFileFixture.failDelete = false
    fixture.source = () => Promise.resolve(image)
  })
  afterEach(async () => {
    if (userIds.length) await db.delete(user).where(inArray(user.id, userIds.splice(0)))
    if (organizationIds.length)
      await db.delete(organization).where(inArray(organization.id, organizationIds.splice(0)))
    await db.delete(fileObject).where(sql`${fileObject.objectKey} like 'files/%'
      and not exists (select 1 from "user" where avatar_file_id = ${fileObject.id})
      and not exists (select 1 from organization where logo_file_id = ${fileObject.id})`)
  })
  async function createProfileFileUser() {
    const [owner] = await db
      .insert(user)
      .values({
        name: "Storage fixture",
        email: `${crypto.randomUUID()}@example.com`,
      })
      .returning()
    userIds.push(owner!.id)
    return owner!
  }

  async function importOwner(
    runtime: ManagedRuntime.ManagedRuntime<
      Layer.Success<typeof profileLayer>,
      Layer.Error<typeof profileLayer>
    >,
    kind: "avatar" | "logo",
    ownerId: string,
    attempts = 0,
  ) {
    const input =
      kind === "avatar"
        ? {
            kind,
            userId: ownerId,
            emailHash: emailHash(
              (await db.select().from(user).where(eq(user.id, ownerId)))[0]!.email,
            ),
          }
        : {
            kind,
            ownerId,
            generation: (
              await db.select().from(organization).where(eq(organization.id, ownerId))
            )[0]!.logoImportGeneration!,
          }
    return runtime.runPromise(
      Effect.flatMap(ProfileFiles, (files) => files.importImage({ ...input, attempts })),
    )
  }

  test("retries imports after a storage outage and reads verified content after restart", async () => {
    const owner = await createProfileFileUser()
    const runtime = ManagedRuntime.make(profileLayer)
    try {
      storedFileFixture.failRead = true
      expect(await importOwner(runtime, "avatar", owner.id, 8)).toBe("storage")
      expect((await db.select().from(user).where(eq(user.id, owner.id)))[0]).toMatchObject({
        image: null,
      })
    } finally {
      await runtime.dispose()
    }
    storedFileFixture.failRead = false
    const restarted = ManagedRuntime.make(profileLayer)
    try {
      expect(await importOwner(restarted, "avatar", owner.id)).toBe("done")
      const [current] = await db.select().from(user).where(eq(user.id, owner.id))
      expect(current!.image).toMatch(/^\/api\/files\/avatars\//)
      const [file] = await db
        .select()
        .from(fileObject)
        .where(eq(fileObject.id, current!.avatarFileId!))
      expect(
        await restarted.runPromise(Effect.flatMap(StoredFiles, (files) => files.read(file!))),
      ).toEqual(image)
      expect(storedFileFixture.objects.has(file!.objectKey)).toBe(true)
    } finally {
      await restarted.dispose()
    }
  })

  test("rejects foreign file claims and enforces upload rate limits", async () => {
    const owner = await createProfileFileUser()
    const other = await createProfileFileUser()
    const [customer] = await db
      .insert(organization)
      .values({ name: "Storage", slug: `storage-${crypto.randomUUID()}` })
      .returning()
    organizationIds.push(customer!.id)
    const runtime = ManagedRuntime.make(profileLayer)
    try {
      const avatar = await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.uploadAvatar({ userId: owner.id, bytes: image }),
        ),
      )
      expect(
        await runtime.runPromise(
          Effect.flatMap(ProfileFiles, (files) =>
            files.validateAvatar({ userId: other.id, image: avatar }),
          ).pipe(Effect.result),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { _tag: "InvalidImage" } })
      expect(
        await runtime.runPromise(
          Effect.flatMap(ProfileFiles, (files) =>
            files.attachLogo({ organizationId: customer!.id, fileId: avatarFileId(avatar)! }),
          ).pipe(Effect.result),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { _tag: "InvalidImage" } })
      await expect(
        db
          .update(user)
          .set({ image: avatar, avatarFileId: avatarFileId(avatar) })
          .where(eq(user.id, other.id)),
      ).rejects.toThrow()
      await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.setAvatar({ userId: owner.id, fileId: avatarFileId(avatar)! }),
        ),
      )
      await db
        .update(fileObject)
        .set({ createdAt: new Date(0) })
        .where(eq(fileObject.id, avatarFileId(avatar)!))
      await runFilePurge(runtime)
      expect(
        (
          await db
            .select()
            .from(fileObject)
            .where(eq(fileObject.id, avatarFileId(avatar)!))
        )[0]!.status,
      ).toBe("stored")
      await db
        .update(user)
        .set({
          image: null,
          avatarFileId: null,
        })
        .where(eq(user.id, owner.id))
      const fileId = await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.uploadLogo({ source: embedded, userId: owner.id }),
        ),
      )
      await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.setLogo({ organizationId: customer!.id, fileId }),
        ),
      )
      await db
        .update(fileObject)
        .set({ createdAt: new Date(0) })
        .where(eq(fileObject.id, fileId))
      await runFilePurge(runtime)
      expect(
        await db
          .select()
          .from(fileObject)
          .where(eq(fileObject.id, avatarFileId(avatar)!)),
      ).toEqual([])
      const [file] = await db.select().from(fileObject).where(eq(fileObject.id, fileId))
      await db.execute(
        sql`update rate_limit set count = 10 where key = ${`effect-rate-limit:profile-upload:${owner.id}`}`,
      )
      for (const upload of [
        Effect.flatMap(ProfileFiles, (files) =>
          files.uploadAvatar({ userId: owner.id, bytes: Uint8Array.of(0) }),
        ),
        Effect.flatMap(ProfileFiles, (files) =>
          files.uploadLogo({ source: "data:image/png;base64,AA==", userId: owner.id }),
        ),
      ])
        expect(await runtime.runPromise(upload.pipe(Effect.result))).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "ImageUploadRateLimited" },
        })
      await db.delete(organization).where(eq(organization.id, customer!.id))
      expect(
        (await db.select().from(fileObject).where(eq(fileObject.id, fileId)))[0]!.organizationId,
      ).toBeNull()
      expect(
        await db.select().from(fileObject).where(eq(fileObject.objectKey, file!.objectKey)),
      ).toHaveLength(1)
      await runFilePurge(runtime)
      expect(storedFileFixture.objects.has(file!.objectKey)).toBe(false)
    } finally {
      await runtime.dispose()
    }
  })

  test("imports Gravatar after account creation and email change, but not sign-in or profile edits", async () => {
    const importedSources: string[] = []
    fixture.source = (source) => {
      importedSources.push(source)
      return Promise.resolve(image)
    }
    const runtime = ManagedRuntime.make(
      profileImageImportWorkflowLayer.pipe(Layer.provideMerge(profileLayer)),
    )
    fixture.run = (effect) => runtime.runPromise(effect)
    await runtime.runPromise(WorkflowEngine.WorkflowEngine)
    const auth = betterAuth({
      baseURL: "http://localhost:3000",
      secret: "gravatar-auth-test-secret-long-enough",
      database: drizzleAdapter(db, { provider: "pg", schema: tables, transaction: true }),
      emailAndPassword: { enabled: true },
      user: { changeEmail: { enabled: true, updateEmailWithoutVerification: true } },
      databaseHooks: { user: gravatarHooks },
      advanced: { database: { generateId: false } },
      plugins: [bearer()],
    })
    const execute = profileImageImport.execute.bind(profileImageImport)
    const submit = vi.spyOn(profileImageImport, "execute")
    const email = `${crypto.randomUUID()}@example.com`
    const password = "profile-import-test-password"
    const signup = await auth.api.signUpEmail({ body: { name: "Gravatar", email, password } })
    userIds.push(signup.user.id)
    const headers = new Headers({ authorization: `Bearer ${signup.token}` })
    const importScheduled = async (address = email) => {
      await runtime.runPromise(
        execute({
          image: { kind: "avatar", userId: signup.user.id, emailHash: emailHash(address) },
        }),
      )
      return (await db.select().from(user).where(eq(user.id, signup.user.id)))[0]!
    }
    try {
      expect((await importScheduled()).image).toMatch(/^\/api\/files\/avatars\//)
      expect(importedSources).toEqual([
        `https://gravatar.com/avatar/${emailHash(email)}?d=404&r=g&s=128`,
      ])
      const manual = await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.uploadAvatar({ userId: signup.user.id, bytes: image }),
        ),
      )
      await runtime.runPromise(
        Effect.flatMap(ProfileFiles, (files) =>
          files.setAvatar({ userId: signup.user.id, fileId: avatarFileId(manual)! }),
        ),
      )
      await auth.api.updateUser({ headers, body: { name: "Edited" } })
      await auth.api.signInEmail({ body: { email, password } })
      expect((await importScheduled()).image).toBe(manual)
      expect(importedSources).toHaveLength(1)
      expect(submit).toHaveBeenCalledTimes(1)
      const nextEmail = `${crypto.randomUUID()}@example.com`
      await auth.api.changeEmail({ headers, body: { newEmail: nextEmail } })
      expect((await importScheduled(nextEmail)).image).not.toBe(manual)
      expect(importedSources).toHaveLength(2)
      expect(submit).toHaveBeenCalledTimes(2)
    } finally {
      submit.mockRestore()
      fixture.run = undefined
      await runtime.dispose()
    }
  })

  test("commits private logo intent with auth updates and imports it through a native workflow", async () => {
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
                logoFileId: privateLogoImportField,
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
          data: { name: "Updated", logo: "https://example.com/new.png" },
        },
      })
    await expect(update()).rejects.toThrow("Rejected organization update")
    expect((await db.select().from(organization).where(eq(organization.id, id)))[0]).toMatchObject({
      name: "Logo import",
      logoImportSourceUrl: null,
    })
    rejectUpdate = false
    const updated = await update()
    expect(updated).not.toHaveProperty("logoImportSourceUrl")
    expect(updated).not.toHaveProperty("logoImportGeneration")
    const [committed] = await db.select().from(organization).where(eq(organization.id, id))
    expect(committed!.logoImportSourceUrl).toBe("https://example.com/new.png")
    const runtime = ManagedRuntime.make(
      profileImageImportWorkflowLayer.pipe(Layer.provideMerge(profileLayer)),
    )
    try {
      const payload = {
        kind: "logo" as const,
        ownerId: id,
        generation: committed!.logoImportGeneration!,
      }
      await runtime.runPromise(fileMaintenance)
      await runtime.runPromise(profileImageImport.execute({ image: payload }))
      const [imported] = await db.select().from(organization).where(eq(organization.id, id))
      expect(imported!.logo).toMatch(/^\/api\/files\/organizations\//)
      expect(imported!.logoImportSourceUrl).toBeNull()
      await runtime.runPromise(profileImageImport.execute({ image: payload }))
      expect(storedFileFixture.objects.size).toBe(1)
    } finally {
      await runtime.dispose()
    }
  })

  test("fences imports on newer profile changes and stops missing or exhausted image sources", async () => {
    const [customer] = await db
      .insert(organization)
      .values({
        name: "Logo",
        slug: `logo-${crypto.randomUUID()}`,
        logoImportGeneration: crypto.randomUUID(),
        logoImportSourceUrl: "https://example.com/replacement.png",
      })
      .returning()
    organizationIds.push(customer!.id)
    const runtime = ManagedRuntime.make(profileLayer)
    try {
      fixture.source = async () => {
        await db
          .update(organization)
          .set({ logo: null, logoImportGeneration: crypto.randomUUID(), logoImportSourceUrl: null })
          .where(eq(organization.id, customer!.id))
        return image
      }
      expect(await importOwner(runtime, "logo", customer!.id)).toBe("done")
      expect(
        (await db.select().from(organization).where(eq(organization.id, customer!.id)))[0],
      ).toMatchObject({ logo: null, logoImportSourceUrl: null })
      for (const [attempts, failure, expected] of [
        [0, new ImageImportUnavailable(), "retry"],
        [7, new ImageImportUnavailable(), "done"],
        [0, new ImageSourceMissing({ status: 404 }), "done"],
      ] as const) {
        const owner = await createProfileFileUser()
        fixture.source = () => Promise.reject(failure)
        expect(await importOwner(runtime, "avatar", owner.id, attempts)).toBe(expected)
      }
    } finally {
      await runtime.dispose()
    }
  })
})
