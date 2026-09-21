import { getRequest } from "@tanstack/react-start/server"

import * as Effect from "effect/Effect"
import { getDatabaseConfigEffect } from "@/db/config.server"
import { isInternalOwner } from "@/db/internal.server"
import { getAuth } from "@/lib/auth.server"
import { getOperatorSession } from "./operator-session.server"

export function getConfigureSession(operatorSession = getOperatorSession()) {
  // Capture request-local values before the shared Effect runtime resumes on database callbacks.
  const headers = getRequest().headers
  return Effect.gen(function* () {
    const operator = yield* Effect.tryPromise({
      try: () => operatorSession,
      catch: () => new Error("Operator session is unavailable"),
    })
    if (!operator) return null
    // Read uncached: another process may have completed provisioning since this process started.
    const state = yield* getDatabaseConfigEffect()
    const internalId = state.values.internal_organization_id
    if (!internalId) {
      if (state.rows?.some((row) => row.key === "internal_organization_id")) {
        return yield* Effect.fail(
          new Error("Internal ownership is unreadable. Restore the database encryption key."),
        )
      }
      return operator
    }
    const session = yield* Effect.tryPromise({
      try: async () => (await getAuth()).api.getSession({ headers }),
      catch: () => new Error("Owner session is unavailable"),
    })
    if (
      !session ||
      !(yield* isInternalOwner({ organizationId: internalId, userId: session.user.id }))
    ) return null
    return operator
  })
}
