import { AsyncLocalStorage } from "node:async_hooks"
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
  logoSource?: string
  logoFileId?: string
}
const requests = new AsyncLocalStorage<ImageRequest>()
export function withProfileImageRequest<A>(call: () => Promise<A>): Promise<A> {
  return requests.run({}, call)
}

export function oauthProfileImage(source: string | undefined): { image: string } {
  const request = requests.getStore()
  if (request) {
    request.oauth = true
    if (source && externalImageUrl(source)) request.oauthSource = source
  }
  return { image: "" }
}

async function imageApiEffect<A, E extends { _tag: string; message: string }>(
  effect: Effect.Effect<A, E, ProfileFiles>,
): Promise<A> {
  const result = await runAppEffect(effect.pipe(Effect.result))
  if (Result.isFailure(result))
    throw new APIError(
      result.failure._tag === "InvalidImage" ? "BAD_REQUEST" : "SERVICE_UNAVAILABLE",
      { code: result.failure._tag, message: result.failure.message },
    )
  return result.success
}

export function isOAuthImageRequest(): boolean {
  return requests.getStore()?.oauth === true
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
  await imageApiEffect(Effect.flatMap(ProfileFiles, (files) => files.validateAvatar(userId, image)))
}

export function enqueueAuthImage(user: { id: string; email: string }): Promise<void> {
  const source = requests.getStore()?.oauthSource
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
    const state = requests.getStore()
    if (!state)
      throw new APIError("BAD_REQUEST", {
        code: "INVALID_IMAGE",
        message: "Image request context is unavailable.",
      })
    if (source.startsWith("data:"))
      state.logoFileId = await imageApiEffect(
        Effect.flatMap(ProfileFiles, (files) => files.prepareLogo(source)),
      )
    else if (externalImageUrl(source)) state.logoSource = source
    else
      throw new APIError("BAD_REQUEST", {
        code: "INVALID_IMAGE",
        message: "Use a valid image or public HTTPS image URL.",
      })
    return { data: { logo: null } }
  },
  afterCreateOrganization: async (input) => {
    const state = requests.getStore()
    if (state?.logoFileId)
      input.organization.logo = await runAppEffect(
        Effect.flatMap(ProfileFiles, (files) =>
          files.adoptLogo(input.organization.id, state.logoFileId!),
        ),
      )
    if (state?.logoSource)
      await runAppEffect(
        Effect.flatMap(ProfileFiles, (files) =>
          files.queueLogo(
            input.organization.id,
            state.logoSource!,
            input.organization.logo ?? null,
          ),
        ),
      )
    await organizationProvisioningHooks.afterCreateOrganization(input)
  },
  beforeUpdateOrganization: async (input) => {
    await organizationRoleHooks.beforeUpdateOrganization(input)
    const source = input.organization.logo
    if (source == null) return undefined
    const state = requests.getStore()
    if (source.startsWith("data:")) {
      const logo = await imageApiEffect(
        Effect.gen(function* () {
          const files = yield* ProfileFiles
          const fileId = yield* files.prepareLogo(source)
          return yield* files.attachLogo(input.member.organizationId, fileId)
        }),
      )
      return { data: { logo } }
    }
    if (externalImageUrl(source)) {
      if (!state)
        throw new APIError("BAD_REQUEST", {
          code: "INVALID_IMAGE",
          message: "Image request context is unavailable.",
        })
      state.logoSource = source
      // An import retains the prior logo until its replacement is verified.
      delete input.organization.logo
      return undefined
    }
    await imageApiEffect(
      Effect.flatMap(ProfileFiles, (files) =>
        files.validateLogo(input.member.organizationId, source),
      ),
    )
    return undefined
  },
  afterUpdateOrganization: async (input) => {
    const source = requests.getStore()?.logoSource
    if (source && input.organization)
      await runAppEffect(
        Effect.flatMap(ProfileFiles, (files) =>
          files.queueLogo(input.member.organizationId, source, input.organization!.logo ?? null),
        ),
      )
  },
} satisfies NonNullable<OrganizationOptions["organizationHooks"]>
