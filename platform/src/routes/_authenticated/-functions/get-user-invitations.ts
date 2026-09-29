import { createServerFn } from "@tanstack/react-start"
import { getRequest, setResponseHeader } from "@tanstack/react-start/server"
import { Effect } from "effect"

import { Auth } from "@/lib/auth/auth.server"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"

/** The invitations addressed to the signed-in user, which the page's `UserInvitations` lists. */
export const getUserInvitations = createServerFn({ method: "GET" }).handler(({ serverFnMeta }) => {
  setResponseHeader("Cache-Control", "no-store")
  const headers = getRequest().headers
  return runEffect(
    Effect.gen(function* () {
      const auth = yield* Auth
      yield* auth.requireSession({ headers })
      return yield* auth.api((api) => api.listUserInvitations({ headers }))
    }).pipe(Effect.catchTag("SignInRequired", exposeError)),
    serverFnMeta.name,
  )
})
