import type { GenericEndpointContext } from "better-auth"
import { APIError } from "better-auth/api"
import { isPasswordCompromised } from "better-auth/plugins"
import { Predicate, Schema } from "effect"

const ResetPasswordBody = Schema.Struct({
  newPassword: Schema.String,
  token: Schema.optional(Schema.String),
})

export async function assertResetPasswordSafe(
  context: GenericEndpointContext,
  checkPassword = isPasswordCompromised,
): Promise<void> {
  const body: unknown = context.body
  if (!Schema.is(ResetPasswordBody)(body)) return
  const { newPassword } = body
  const { minPasswordLength, maxPasswordLength } = context.context.password.config
  if (newPassword.length < minPasswordLength || newPassword.length > maxPasswordLength) return
  const query: unknown = context.query
  const token = body.token || (Predicate.hasProperty(query, "token") ? query.token : undefined)
  if (!Predicate.isString(token) || !token) return
  const verification = await context.context.internalAdapter.findVerificationValue(
    `reset-password:${token}`,
  )
  if (!verification || verification.expiresAt < new Date()) return

  // Reject before Better Auth atomically consumes the link, retaining it when password checks fail.
  // https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/api/routes/password.ts
  if (await checkPassword(newPassword)) {
    throw new APIError("BAD_REQUEST", {
      code: "PASSWORD_COMPROMISED",
      message: "The password you entered has been compromised. Please choose a different password.",
    })
  }
}
