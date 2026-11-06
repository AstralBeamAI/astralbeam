import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { effectHandler, exposeError } from "@/lib/runtime/server-fn.server"
import { checkConfigureRequest } from "../-lib/configure-request.server"
import { clearOperatorSessionCookie } from "../-lib/operator-session.server"

export const logoutOperator = createServerFn({ method: "POST" }).handler(
  effectHandler(() =>
    checkConfigureRequest().pipe(
      Effect.andThen(clearOperatorSessionCookie()),
      Effect.catchTag(["ConfigureHttpsRequired", "ConfigureRequestForbidden"], exposeError),
    ),
  ),
)
