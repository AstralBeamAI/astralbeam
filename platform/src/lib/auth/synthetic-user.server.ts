import { SecureRandom } from "effect/crypto"

export interface SyntheticUserFields {
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Match the UUIDv7 shape returned by PostgreSQL so duplicate email signups cannot be distinguished
 * from new signups by inspecting Better Auth's synthetic response ID. https://better-auth.com/docs/authentication/email-password#email-enumeration-protection
 */
export function createSyntheticUser(fields: SyntheticUserFields): Record<string, unknown> {
  return { ...fields, id: SecureRandom.uuidV7Unsafe() }
}
