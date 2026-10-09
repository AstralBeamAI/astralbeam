import { defineRequestState } from "@better-auth/core/context"
import { APIError } from "better-auth/api"
import type { OrganizationOptions } from "better-auth/plugins"
import { Effect, Result } from "effect"

import {
  organizationRoleHooks,
  organizationProvisioningHooks,
} from "@/lib/organizations/hooks.server"
import { runAppEffect } from "@/lib/runtime/app-effect.server"
import { ProfileFiles } from "./profile-files.server"

interface ImageRequest {
  oauth?: boolean
  oauthSource?: string
  logoGeneration?: string
  logoSource?: string
  logoFileId?: string
}
const requests = defineRequestState<ImageRequest>(() => ({}))
export const logoImportGenerationField = {
  type: "string",
  input: false,
  returned: false,
  required: false,
} as const

export async function oauthProfileImage(source: string | undefined): Promise<{ image: string }> {
  const request = await requests.get()
  request.oauth = true
  if (source && externalImageUrl(source)) request.oauthSource = source
  return { image: "" }
}

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
): Promise<void> {
  if (image == null) return
  if (!userId)
    throw new APIError("BAD_REQUEST", {
      code: "INVALID_IMAGE",
      message: "Upload your avatar after creating your account.",
    })
  await imageApiEffect(
    Effect.flatMap(ProfileFiles, (files) => files.validateAvatar({ userId, image })),
  )
}

export async function enqueueAuthImage(user: { id: string; email: string }): Promise<void> {
  const source = (await requests.get()).oauthSource
  return runAppEffect(
    Effect.flatMap(ProfileFiles, (files) =>
      files.queueAvatar({ userId: user.id, email: user.email, ...(source ? { source } : {}) }),
    ).pipe(
      Effect.catchCause(() => Effect.logWarning("Profile image import could not be scheduled")),
    ),
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
    if (source.startsWith("data:"))
      state.logoFileId = await imageApiEffect(
        Effect.flatMap(ProfileFiles, (files) =>
          files.prepareLogo({ source, userId: input.user.id }),
        ),
      )
    else if (externalImageUrl(source)) {
      state.logoSource = source
      state.logoGeneration = crypto.randomUUID()
    } else
      throw new APIError("BAD_REQUEST", {
        code: "INVALID_IMAGE",
        message: "Use a valid image or public HTTPS image URL.",
      })
    return { data: { logo: null, logoImportGeneration: state.logoGeneration } }
  },
  afterCreateOrganization: async (input) => {
    await organizationProvisioningHooks.afterCreateOrganization(input)
    const state = await requests.get()
    if (state.logoFileId)
      input.organization.logo = await runAppEffect(
        Effect.flatMap(ProfileFiles, (files) =>
          files.adoptLogo({ organizationId: input.organization.id, fileId: state.logoFileId! }),
        ),
      )
    if (state.logoSource)
      await runAppEffect(
        Effect.flatMap(ProfileFiles, (files) =>
          files.queueLogo({
            organizationId: input.organization.id,
            source: state.logoSource!,
            expectedLogo: input.organization.logo ?? null,
            generation: state.logoGeneration!,
          }),
        ),
      )
  },
  beforeUpdateOrganization: async (input) => {
    await organizationRoleHooks.beforeUpdateOrganization(input)
    const source = input.organization.logo
    if (source === undefined) return undefined
    const logoImportGeneration = crypto.randomUUID()
    if (source === null) return { data: { logo: null, logoImportGeneration } }
    const state = await requests.get()
    if (source.startsWith("data:")) {
      const logo = await imageApiEffect(
        Effect.gen(function* () {
          const files = yield* ProfileFiles
          const fileId = yield* files.prepareLogo({ source, userId: input.user.id })
          return yield* files.attachLogo({ organizationId: input.member.organizationId, fileId })
        }),
      )
      return { data: { logo, logoImportGeneration } }
    }
    if (externalImageUrl(source)) {
      state.logoSource = source
      state.logoGeneration = logoImportGeneration
      // An import retains the prior logo until its replacement is verified.
      delete input.organization.logo
      return { data: { ...input.organization, logoImportGeneration } }
    }
    await imageApiEffect(
      Effect.flatMap(ProfileFiles, (files) =>
        files.validateLogo({ organizationId: input.member.organizationId, image: source }),
      ),
    )
    return { data: { ...input.organization, logoImportGeneration } }
  },
  afterUpdateOrganization: async (input) => {
    const { logoSource: source, logoGeneration } = await requests.get()
    if (source && input.organization)
      await runAppEffect(
        Effect.flatMap(ProfileFiles, (files) =>
          files.queueLogo({
            organizationId: input.member.organizationId,
            source,
            expectedLogo: input.organization!.logo ?? null,
            generation: logoGeneration!,
          }),
        ),
      )
  },
} satisfies NonNullable<OrganizationOptions["organizationHooks"]>
