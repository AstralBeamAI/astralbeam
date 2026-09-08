import { createHash } from "node:crypto"

import type { ChatPrincipal } from "./types"

/** Opaque identity for JWT external IDs; the JSON tuple makes arbitrary text unambiguous. */
export function chatPrincipalScope(principal: ChatPrincipal): string {
  return createHash("sha256")
    .update(JSON.stringify([
      principal.organization.id,
      principal.tenantUser.tenant.id,
      principal.tenantUser.id,
    ]))
    .digest("base64url")
}
