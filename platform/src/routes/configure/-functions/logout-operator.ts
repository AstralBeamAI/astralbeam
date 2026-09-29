import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { checkConfigureRequest } from "../-lib/configure-request.server"
import { clearOperatorSessionCookie } from "../-lib/operator-session.server"

export const logoutOperator = createServerFn({ method: "POST" }).handler(({ serverFnMeta }) =>
  runEffect(
    checkConfigureRequest().pipe(
      Effect.andThen(Effect.sync(clearOperatorSessionCookie)),
      Effect.catchTag(["ConfigureHttpsRequired", "ConfigureRequestForbidden"], exposeError),
    ),
    serverFnMeta.name,
  ),
)
