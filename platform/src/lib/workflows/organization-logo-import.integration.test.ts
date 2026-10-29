import { eq, inArray, sql } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, describe, expect, test } from "vitest"

import { getAuthDatabase } from "@/db/database"
import { fileObject } from "@/db/schema/files"
import { organization } from "@/db/schema/organizations"
import { ImageSources } from "@/lib/storage/image-source.server"
import { StoredFiles } from "@/lib/storage/stored-files.server"
import { storedFileFixture, storedFilePurgeLayer } from "@/lib/storage/stored-files.fixture"
import organizationLogoImport, {
  organizationLogoImportWorkflowLayer,
} from "./organization-logo-import"

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
const ids: string[] = []
const image = { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" }

describe.skipIf(!databaseUrl)("organization logo import", () => {
  afterEach(async () => {
    if (ids.length) {
      await db.delete(organization).where(inArray(organization.id, ids.splice(0)))
    }
    storedFileFixture.objects.clear()
  })

  async function createLogoOrganization() {
    const [created] = await db
      .insert(organization)
      .values({
        name: "Logo import",
        slug: `logo-${crypto.randomUUID()}`,
        domain: "example.com",
      })
      .returning({
        organizationId: organization.id,
        updatedAt: sql<string>`${organization.updatedAt}::text`,
      })
    ids.push(created!.organizationId)
    return { ...created!, imageUrl: "https://example.com/logo.png" }
  }

  function logoRuntime(fetch: ImageSources["Service"]["fetch"]) {
    return ManagedRuntime.make(
      organizationLogoImportWorkflowLayer.pipe(
        Layer.provideMerge([storedFilePurgeLayer, Layer.succeed(ImageSources, { fetch })]),
      ),
    )
  }

  test("persists an imported logo without retiring its stored file", async () => {
    const input = await createLogoOrganization()
    const runtime = logoRuntime(() => Effect.succeed(image))
    try {
      await runtime.runPromise(organizationLogoImport.execute(input))
      const [saved] = await db
        .select()
        .from(organization)
        .where(eq(organization.id, input.organizationId))
      const [file] = await db.select().from(fileObject).where(eq(fileObject.id, saved!.logoFileId!))
      expect(file?.status).toBe("stored")
    } finally {
      await runtime.dispose()
    }
  })

  test.each([false, true])(
    "manual change wins during lookup (uploaded: %s) and the unused imported file is retired",
    async (upload) => {
      const input = await createLogoOrganization()
      const { organizationId } = input
      let manualId: string | null = null
      const runtime = logoRuntime(() =>
        Effect.promise(async () => {
          await db
            .update(organization)
            .set({ logoFileId: manualId, updatedAt: sql`clock_timestamp()` })
            .where(eq(organization.id, organizationId))
          return image
        }),
      )
      try {
        if (upload)
          manualId = (
            await runtime.runPromise(
              Effect.flatMap(StoredFiles, (files) => files.upload({ ...image, organizationId })),
            )
          ).id
        await runtime.runPromise(organizationLogoImport.execute(input))
        expect(
          (await db.select().from(organization).where(eq(organization.id, organizationId)))[0]!
            .logoFileId,
        ).toBe(manualId)
        const files = await db
          .select()
          .from(fileObject)
          .where(eq(fileObject.organizationId, organizationId))
        expect(files.filter((file) => file.id !== manualId).map((file) => file.status)).toEqual([
          "purging",
        ])
      } finally {
        await runtime.dispose()
      }
    },
  )
})
