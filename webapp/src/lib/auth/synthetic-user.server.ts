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
  return { ...fields, id: createUuidV7() }
}

function createUuidV7(now = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let timestamp = BigInt(now)

  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn)
    timestamp >>= 8n
  }

  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${
    hex.slice(20)
  }`
}
