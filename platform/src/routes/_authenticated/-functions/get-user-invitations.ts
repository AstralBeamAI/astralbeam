import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { Auth } from "@/lib/auth/auth.server"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { ServerRequest } from "@/lib/runtime/server-request.server"

/** The invitations addressed to the signed-in user, which the page's `UserInvitations` lists. */
export const getUserInvitations = createServerFn({ method: "GET" }).handler(({ serverFnMeta }) =>
  runEffect(
    Effect.gen(function* () {
      const server = yield* ServerRequest
      yield* server.setHeaders({ "Cache-Control": "no-store" })
      const { headers } = server.request
      const auth = yield* Auth
      yield* auth.requireSession({ headers })
      return yield* auth.api((api) => api.listUserInvitations({ headers }))
    }).pipe(Effect.catchTag("SignInRequired", exposeError)),
    serverFnMeta.name,
  ),
)
