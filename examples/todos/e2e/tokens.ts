import { createAstralBeamToken } from "@astralbeam/sdk/server"

import { seedTarget } from "./worktree.ts"

export function mintSeedChatAuthToken(apiKey: string): Promise<string> {
  return createAstralBeamToken({ apiKey, user: seedTarget.user, tenant: seedTarget.tenant })
}

/** Reads a JWT's protected header without verifying it; the header names the signing API key. */
export function readJwtHeader(token: string): { kid?: string } {
  const [encodedHeader] = token.split(".")
  if (!encodedHeader) throw new Error("The token is not a JWT")
  const base64 = encodedHeader.replaceAll("-", "+").replaceAll("_", "/")
  return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as { kid?: string }
}
