import { verifiedImage } from "@/lib/storage/image-source.server"
import { eq, inArray } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

import { getAuthDatabase } from "@/db/database"
import { user } from "@/db/schema/authentication"
import { member, organization } from "@/db/schema/organizations"
import { ImageSources } from "@/lib/storage/image-source.server"
import { InvalidImage } from "@/lib/storage/errors"
import profileImageImport, { profileImageImportWorkflowLayer } from "./profile-image-import"
import { StoredFiles } from "@/lib/storage/stored-files.server"
import { storedFileFixture, storedFilePurgeLayer } from "@/lib/storage/stored-files.fixture"

const configured = process.env.DATABASE_URL
const databaseUrl =
  configured === "postgres://test:test@127.0.0.1:5432/test" ? undefined : configured
if (
  databaseUrl &&
  (new URL(databaseUrl).hostname !== "127.0.0.1" ||
    !new URL(databaseUrl).pathname.endsWith("_test"))
)
  throw new Error("Use a disposable loopback database ending in _test")
const fixture = {
  source: (_source: string): Promise<Uint8Array> => Promise.resolve(new Uint8Array()),
}

const image = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP438AAAAQBAYCQNzXrAAAAAElFTkSuQmCC",
    "base64",
  ),
)
const profileLayer = profileImageImportWorkflowLayer.pipe(
  Layer.provideMerge([
    storedFilePurgeLayer,
    Layer.succeed(ImageSources, {
      fetch: ({ source }) =>
        Effect.tryPromise({
          try: () => fixture.source(source),
          catch: (error) => (error instanceof InvalidImage ? error : new InvalidImage()),
        }).pipe(Effect.flatMap(verifiedImage)),
    }),
  ]),
)
const db = getAuthDatabase()
const userIds: string[] = []
const organizationIds: string[] = []

describe.skipIf(!databaseUrl)("Organization profile files", () => {
  beforeEach(() => {
    storedFileFixture.objects.clear()
    storedFileFixture.failRead = false
    storedFileFixture.corruptRead = false
    storedFileFixture.failDelete = false
    fixture.source = () => Promise.resolve(image)
  })
  afterEach(async () => {
    if (userIds.length) await db.delete(user).where(inArray(user.id, userIds.splice(0)))
    if (organizationIds.length)
      await db.delete(organization).where(inArray(organization.id, organizationIds.splice(0)))
  })
  async function createProfileMember(userId?: string) {
    if (!userId) {
      const [owner] = await db
        .insert(user)
        .values({
          name: "Profile",
          email: `profile-${crypto.randomUUID()}@example.com`,
          emailVerified: true,
        })
        .returning()
      userId = owner!.id
      userIds.push(userId)
    }
    const [customer] = await db
      .insert(organization)
      .values({ domain: "example.com", name: "Profiles", slug: `profiles-${crypto.randomUUID()}` })
      .returning()
    organizationIds.push(customer!.id)
    const [membership] = await db
      .insert(member)
      .values({ organizationId: customer!.id, userId, role: "owner" })
      .returning()
    return { organizationId: customer!.id, memberId: membership!.id, userId }
  }

  test("imports a valid source across all memberships and preserves avatars when unavailable", async () => {
    const first = await createProfileMember()
    await createProfileMember(first.userId)
    const runtime = ManagedRuntime.make(profileLayer)
    const input = { userId: first.userId, imageUrl: "https://images.example/avatar.png" }
    try {
      const manual = await runtime.runPromise(
        Effect.flatMap(StoredFiles, (files) =>
          files.upload({
            organizationId: first.organizationId,
            bytes: image,
            contentType: "image/png",
          }),
        ),
      )
      await db.update(member).set({ avatarFileId: manual.id }).where(eq(member.id, first.memberId))
      const [original] = await db.select().from(member).where(eq(member.id, first.memberId))
      fixture.source = () => Promise.reject(new InvalidImage())
      await runtime.runPromise(profileImageImport.execute(input))
      expect(
        (await db.select().from(member).where(eq(member.id, first.memberId)))[0]!.avatarFileId,
      ).toBe(original!.avatarFileId)
      fixture.source = () => Promise.resolve(image)
      await runtime.runPromise(profileImageImport.execute(input))
      const memberships = await db.select().from(member).where(eq(member.userId, first.userId))
      expect(memberships.every((membership) => membership.avatarFileId !== null)).toBe(true)
      expect(
        memberships.find((membership) => membership.id === first.memberId)!.avatarFileId,
      ).not.toBe(original!.avatarFileId)
      expect(memberships[0]!.avatarFileId).not.toBe(memberships[1]!.avatarFileId)
      await expect(
        db
          .update(member)
          .set({ avatarFileId: memberships[0]!.avatarFileId })
          .where(eq(member.id, memberships[1]!.id)),
      ).rejects.toThrow()
    } finally {
      await runtime.dispose()
    }
  })
})
