import { defineRequestState } from "@better-auth/core/context"
import { APIError } from "better-auth/api"
import type { OrganizationOptions } from "better-auth/plugins"
import { and, eq, sql } from "drizzle-orm"
import { Effect, Result, Schema } from "effect"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { fileObject } from "@/db/schema/files"
import { member, organization } from "@/db/schema/organizations"
import { enqueueGravatar } from "@/lib/auth/profile-images.server"
import { runAppEffect } from "@/lib/runtime/app-effect.server"
import type { DatabaseRateLimiter } from "@/db/lib/rate-limiter"
import { UuidV7Schema } from "@/lib/schemas"
import { InvalidImage } from "@/lib/storage/errors"
import { ImageSources } from "@/lib/storage/image-source.server"
import { embeddedImage } from "@/lib/storage/image-source.server"
import { StoredFiles } from "@/lib/storage/stored-files.server"
import { organizationRoleHooks, organizationProvisioningHooks } from "./hooks.server"
import { logoFileUrl } from "./images"
import { consumeImageUpload, retireImage } from "./images.server"
import { enqueueOrganizationLogoImport } from "./logo-import.server"

const organizationImageRequest = defineRequestState<{
  logo?: { bytes: Uint8Array; contentType: string }
  previousLogoId?: string | null
}>(() => ({}))

const prepareOrganizationLogo = Effect.fn("prepareOrganizationLogo")(function* ({
  source,
  userId,
}: {
  source: string
  userId: string
}) {
  yield* consumeImageUpload({ userId })
  return yield* source.startsWith("data:")
    ? embeddedImage(source)
    : (yield* ImageSources).fetch({ source })
})
const validateOrganizationLogo = Effect.fn("validateOrganizationLogo")(function* ({
  organizationId,
  image,
}: {
  organizationId: string
  image: string
}) {
  const db = yield* Database
  const prefix = logoFileUrl(organizationId, "")
  if (!image.startsWith(prefix) || !Schema.is(UuidV7Schema)(image.slice(prefix.length)))
    return yield* new InvalidImage()
  // A stored URL may keep the current logo. Other files must enter through the image upload path.
  const [file] = yield* db
    .select({ id: fileObject.id })
    .from(fileObject)
    .innerJoin(
      organization,
      and(
        eq(organization.id, fileObject.organizationId),
        eq(organization.logoFileId, fileObject.id),
      ),
    )
    .where(
      and(
        eq(fileObject.organizationId, organizationId),
        eq(fileObject.id, image.slice(prefix.length)),
        eq(fileObject.status, "stored"),
      ),
    )
    .pipe(mapDatabaseErrors())
  if (!file) return yield* new InvalidImage()
  return file.id
})
async function imageApiEffect<A, E extends { _tag: string; message: string }>(
  effect: Effect.Effect<A, E, Database | DatabaseRateLimiter | StoredFiles | ImageSources>,
): Promise<A> {
  const result = await runAppEffect(effect.pipe(Effect.result))
  if (Result.isFailure(result))
    throw new APIError(
      result.failure._tag === "InvalidImage"
        ? "BAD_REQUEST"
        : result.failure._tag === "ImageUploadRateLimited"
          ? "TOO_MANY_REQUESTS"
          : "SERVICE_UNAVAILABLE",
      { code: result.failure._tag, message: result.failure.message },
    )
  return result.success
}

export const organizationImageHooks = {
  ...organizationRoleHooks,
  beforeAcceptInvitation: async (input) => {
    await organizationRoleHooks.beforeAcceptInvitation(input)
    // Remove this precheck when https://github.com/better-auth/better-auth/pull/9193 ships
    // and the installed acceptInvitation reuses existing memberships. Keep the unique index.
    const existing = await runAppEffect(
      Effect.flatMap(Database, (db) =>
        db
          .select({ id: member.id })
          .from(member)
          .where(
            and(
              eq(member.organizationId, input.invitation.organizationId),
              eq(member.userId, input.user.id),
            ),
          )
          .limit(1)
          .pipe(Effect.orDie),
      ),
    )
    if (existing.length)
      throw new APIError("BAD_REQUEST", {
        code: "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
        message: "User is already a member of this organization",
      })
  },
  afterAddMember: enqueueGravatar,
  afterAcceptInvitation: enqueueGravatar,
  afterRemoveMember: ({
    member,
  }: {
    member: { organizationId: string; avatarFileId?: string | null }
  }): Promise<void> =>
    runAppEffect(
      retireImage({ organizationId: member.organizationId, fileId: member.avatarFileId ?? null }),
    ),
  beforeCreateOrganization: async (input) => {
    await organizationRoleHooks.beforeCreateOrganization(input)
    const domain = input.user.email.slice(input.user.email.lastIndexOf("@") + 1).toLowerCase()
    const source = input.organization.logo
    const data = { domain, logo: null, logoFileId: null }
    if (!source) return { data }
    const state = await organizationImageRequest.get()
    state.logo = await imageApiEffect(prepareOrganizationLogo({ source, userId: input.user.id }))
    return { data }
  },
  afterCreateOrganization: async (input) => {
    await organizationProvisioningHooks.afterCreateOrganization(input)
    const image = (await organizationImageRequest.get()).logo
    if (!image) {
      await enqueueOrganizationLogoImport({ organizationId: input.organization.id })
      return
    }
    // Creation has committed, so a failed optional logo upload must not report a failed creation.
    const saved = await runAppEffect(
      Effect.gen(function* () {
        const files = yield* StoredFiles
        const db = yield* Database
        const file = yield* files.upload({ organizationId: input.organization.id, ...image })
        const logo = { logoFileId: file.id }
        yield* db
          .update(organization)
          .set(logo)
          .where(eq(organization.id, input.organization.id))
          .pipe(mapDatabaseErrors())
        return logo
      }).pipe(
        Effect.catchCause(() =>
          Effect.as(Effect.logWarning("Could not store the new Organization logo"), undefined),
        ),
      ),
    )
    if (saved) Object.assign(input.organization, saved)
  },
  beforeUpdateOrganization: async (input) => {
    await organizationRoleHooks.beforeUpdateOrganization(input)
    const source = input.organization.logo
    if (source === undefined) return
    const organizationId = input.member.organizationId
    // Invalidate older imports and read the current reference atomically before replacing it.
    const [current] = await imageApiEffect(
      Effect.flatMap(Database, (db) =>
        db
          .update(organization)
          .set({ updatedAt: sql`clock_timestamp()` })
          .where(eq(organization.id, organizationId))
          .returning({ logoFileId: organization.logoFileId })
          .pipe(mapDatabaseErrors()),
      ),
    )
    const state = await organizationImageRequest.get()
    state.previousLogoId = current?.logoFileId ?? null
    if (source === null) return { data: { logo: null, logoFileId: null } }
    if (source.startsWith("/api/files/")) {
      const logoFileId = await imageApiEffect(
        validateOrganizationLogo({ organizationId, image: source }),
      )
      return { data: { logo: null, logoFileId } }
    }
    const saved = await imageApiEffect(
      Effect.gen(function* () {
        const image = yield* prepareOrganizationLogo({ source, userId: input.user.id })
        return yield* (yield* StoredFiles).upload({ organizationId, ...image })
      }),
    )
    return { data: { logo: null, logoFileId: saved.id } }
  },
  afterUpdateOrganization: async (input) => {
    const fileId = (await organizationImageRequest.get()).previousLogoId ?? null
    await runAppEffect(retireImage({ organizationId: input.member.organizationId, fileId }))
  },
} satisfies NonNullable<OrganizationOptions["organizationHooks"]>
