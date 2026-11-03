import { createHash } from "node:crypto"
import { defineRequestState } from "@better-auth/core/context"
import { APIError } from "better-auth/api"
import { Effect } from "effect"

import { runAppEffect } from "@/lib/runtime/app-effect.server"
import profileImageImport from "@/lib/workflows/profile-image-import"

const profileImageRequest = defineRequestState<{
  oauth?: boolean
  imageUrl?: string | undefined
}>(() => ({}))

export async function captureOAuthImage(imageUrl: string | undefined): Promise<{ image: string }> {
  const state = await profileImageRequest.get()
  state.oauth = true
  state.imageUrl = imageUrl
  return { image: "" }
}
export async function isOAuthImageRequest(): Promise<boolean> {
  return (await profileImageRequest.get()).oauth === true
}
export function assertNoGlobalAvatar(image: string | null | undefined): void {
  if (image != null)
    throw new APIError("BAD_REQUEST", {
      code: "INVALID_IMAGE",
      message: "Update your avatar from your Organization's Members page.",
    })
}

async function enqueueProfileImage(input: { userId: string; imageUrl: string }): Promise<void> {
  // Loaded after authentication commits, avoiding the Auth -> runtime -> Auth initialization cycle.
  const { provideClusterWorkflowEngine } = await import("@/lib/cluster/runtime")
  await runAppEffect(
    profileImageImport.execute(input, { discard: true }).pipe(
      provideClusterWorkflowEngine,
      Effect.catchCause(() =>
        Effect.logWarning("Could not schedule optional profile image import"),
      ),
    ),
  )
}

export async function enqueueGravatar(input: {
  user: { id: string; email: string }
}): Promise<void> {
  if (await isOAuthImageRequest()) return
  const hash = createHash("sha256").update(input.user.email.trim().toLowerCase()).digest("hex")
  await enqueueProfileImage({
    userId: input.user.id,
    imageUrl: `https://gravatar.com/avatar/${hash}?d=404&r=g&s=128`,
  })
}

export async function enqueueOAuthProfileImage(userId: string): Promise<void> {
  const imageUrl = (await profileImageRequest.get()).imageUrl
  if (imageUrl) await enqueueProfileImage({ userId, imageUrl })
}
