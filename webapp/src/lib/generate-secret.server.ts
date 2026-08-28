import { randomBytes } from "node:crypto"

export function generateSecret(): string {
  return randomBytes(32).toString("base64url")
}
