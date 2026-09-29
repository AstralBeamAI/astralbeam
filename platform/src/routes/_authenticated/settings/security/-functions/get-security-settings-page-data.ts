import { createServerFn } from "@tanstack/react-start"
import { getRequest, setResponseHeader } from "@tanstack/react-start/server"
import { Effect } from "effect"

import { Auth } from "@/lib/auth/auth.server"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"

/** Linked accounts and active sessions, `null` when listing needs a fresh sign-in. */
export const getSecuritySettingsPageData = createServerFn({ method: "GET" }).handler(
  ({ serverFnMeta }) => {
    setResponseHeader("Cache-Control", "no-store")
    const headers = getRequest().headers
    return runEffect(
      Effect.gen(function* () {
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
    )
  },
)
