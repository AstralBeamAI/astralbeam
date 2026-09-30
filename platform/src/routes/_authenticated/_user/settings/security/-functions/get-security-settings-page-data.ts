import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { Auth } from "@/lib/auth/auth.server"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { ServerRequest } from "@/lib/runtime/server-request.server"

/** Linked accounts and active sessions, `null` when listing needs a fresh sign-in. */
export const getSecuritySettingsPageData = createServerFn({ method: "GET" }).handler(
  ({ serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const server = yield* ServerRequest
        yield* server.setHeaders({ "Cache-Control": "no-store" })
        const { headers } = server.request
        const auth = yield* Auth
        yield* auth.requireSession({ headers })
        return yield* Effect.all(
          {
            accounts: auth.freshApi((api) => api.listUserAccounts({ headers })),
            sessions: auth.freshApi((api) => api.listSessions({ headers })),
          },
          { concurrency: "unbounded" },
        )
      }).pipe(Effect.catchTag("SignInRequired", exposeError)),
      serverFnMeta.name,
    ),
)
