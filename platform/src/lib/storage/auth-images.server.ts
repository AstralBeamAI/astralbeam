import { createHash } from "node:crypto"
import type { BetterAuthOptions } from "better-auth"
import { defineRequestState } from "@better-auth/core/context"
import { APIError } from "better-auth/api"
import type { OrganizationOptions } from "better-auth/plugins"
import { Effect, Result } from "effect"

import {
  organizationRoleHooks,
  organizationProvisioningHooks,
} from "@/lib/organizations/hooks.server"
import { runAppEffect } from "@/lib/runtime/app-effect.server"
import profileImageImport from "@/lib/workflows/profile-image-import"
import { ProfileFiles } from "./profile-files.server"

interface ImageRequest {
  changedEmail?: string
  oauth?: boolean
  logoFileId?: string
}
const requests = defineRequestState<ImageRequest>(() => ({}))
export const privateLogoImportField = {
  type: "string",
  input: false,
  returned: false,
  required: false,
} as const

export async function oauthProfileImage(): Promise<{ image: string }> {
  const request = await requests.get()
  request.oauth = true
  return { image: "" }
}

async function enqueueGravatar(user: { id: string; email: string }): Promise<void> {
  // Load after authentication commits, avoiding the Auth -> runtime -> Auth initialization cycle.
  const { provideClusterWorkflowEngine } = await import("@/lib/cluster/runtime")
  await runAppEffect(
    profileImageImport
      .execute(
        {
          image: {
            kind: "avatar",
            userId: user.id,
            emailHash: createHash("sha256").update(user.email.trim().toLowerCase()).digest("hex"),
          },
        },
        { discard: true },
      )
      .pipe(
        provideClusterWorkflowEngine,
        Effect.catchCause(() => Effect.logWarning("Could not schedule optional Gravatar import")),
      ),
  )
}

export const gravatarHooks = {
  create: { after: enqueueGravatar },
  update: {
    before: async (data, context) => {
      if (!data.email || !context) return
      const email = data.email.trim().toLowerCase()
      // Email is unique. An existing address means an unchanged value or a rejected collision.
      // The internal adapter reuses Better Auth's current transaction.
      if (!(await context.context.internalAdapter.findUserByEmail(email)))
        (await requests.get()).changedEmail = email
    },
    after: async (user) => {
      const state = await requests.get()
      if (state.changedEmail !== user.email.trim().toLowerCase()) return
      delete state.changedEmail
      await enqueueGravatar(user)
    },
  },
} satisfies NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["user"]>

async function imageApiEffect<A, E extends { _tag: string; message: string }>(
  effect: Effect.Effect<A, E, ProfileFiles>,
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

export async function isOAuthImageRequest(): Promise<boolean> {
  return (await requests.get()).oauth === true
}

export async function assertOwnedAvatar(
  userId: string | undefined,
  image: string | null | undefined,
): Promise<string | null | undefined> {
  if (image == null) return image
  if (!userId)
    throw new APIError("BAD_REQUEST", {
      code: "INVALID_IMAGE",
      message: "Upload your avatar after creating your account.",
    })
  return imageApiEffect(
    Effect.flatMap(ProfileFiles, (files) => files.validateAvatar({ userId, image })),
  )
}

function externalImageUrl(source: string): boolean {
  try {
    const url = new URL(source)
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!url.port || url.port === "443")
    )
  } catch {
    return false
  }
}

export const organizationImageHooks = {
  ...organizationRoleHooks,
  beforeCreateOrganization: async (input) => {
    await organizationRoleHooks.beforeCreateOrganization(input)
    const source = input.organization.logo
    if (!source) return
    const state = await requests.get()
    let logoImportSourceUrl: string | null = null
    if (source.startsWith("data:"))
      state.logoFileId = await imageApiEffect(
        Effect.flatMap(ProfileFiles, (files) =>
          files.uploadLogo({ source, userId: input.user.id }),
        ),
      )
    else if (externalImageUrl(source)) logoImportSourceUrl = source
    else
      throw new APIError("BAD_REQUEST", {
        code: "INVALID_IMAGE",
        message: "Use a valid image or public HTTPS image URL.",
      })
    return {
      data: {
        logo: null,
        logoFileId: null,
        logoImportGeneration: crypto.randomUUID(),
        logoImportSourceUrl,
      },
    }
  },
  afterCreateOrganization: async (input) => {
    await organizationProvisioningHooks.afterCreateOrganization(input)
    const state = await requests.get()
    if (state.logoFileId)
      input.organization.logo = await runAppEffect(
        Effect.flatMap(ProfileFiles, (files) =>
          files.setLogo({ organizationId: input.organization.id, fileId: state.logoFileId! }),
        ),
      )
  },
  beforeUpdateOrganization: async (input) => {
    await organizationRoleHooks.beforeUpdateOrganization(input)
    const source = input.organization.logo
    if (source === undefined) return undefined
    const logoImportGeneration = crypto.randomUUID()
    if (source === null)
      return {
        data: { logo: null, logoFileId: null, logoImportGeneration, logoImportSourceUrl: null },
      }
    if (source.startsWith("data:")) {
      const image = await imageApiEffect(
        Effect.gen(function* () {
          const files = yield* ProfileFiles
          const fileId = yield* files.uploadLogo({ source, userId: input.user.id })
          const logo = yield* files.attachLogo({
            organizationId: input.member.organizationId,
            fileId,
          })
          return { logo, logoFileId: fileId }
        }),
      )
      return { data: { ...image, logoImportGeneration, logoImportSourceUrl: null } }
    }
    if (externalImageUrl(source)) {
      // An import retains the prior logo until its replacement is verified.
      delete input.organization.logo
      return {
        data: { ...input.organization, logoImportGeneration, logoImportSourceUrl: source },
      }
    }
    const logoFileId = await imageApiEffect(
      Effect.flatMap(ProfileFiles, (files) =>
        files.validateLogo({ organizationId: input.member.organizationId, image: source }),
      ),
    )
    return {
      data: { ...input.organization, logoFileId, logoImportGeneration, logoImportSourceUrl: null },
    }
  },
} satisfies NonNullable<OrganizationOptions["organizationHooks"]>
