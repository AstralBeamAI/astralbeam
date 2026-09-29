import { createMiddleware, createServerOnlyFn } from "@tanstack/react-start"
import { Effect, Option } from "effect"

import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { checkConfigureRequest } from "./configure-request.server.ts"
import { OperatorSessionRequired } from "./errors.ts"
import { readOperatorSession } from "./operator-session.server.ts"

const authorizeConfigureRequest = createServerOnlyFn((operation: string) =>
  runEffect(
    checkConfigureRequest().pipe(
      Effect.andThen(readOperatorSession),
      Effect.flatMap((session) =>
        Option.isSome(session) ? Effect.void : Effect.fail(new OperatorSessionRequired()),
      ),
      Effect.catchTag(
        ["ConfigureHttpsRequired", "ConfigureRequestForbidden", "OperatorSessionRequired"],
        exposeError,
      ),
    ),
    operation,
  ),
)

/** Requires the operator session, independent of dashboard sessions and dogfood membership. */
export const configureMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next, serverFnMeta }) => {
    await authorizeConfigureRequest(serverFnMeta.name)
    return next()
  },
)
