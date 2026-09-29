import { createServerFn } from "@tanstack/react-start"
import { setResponseHeader } from "@tanstack/react-start/server"
import { Effect, Schema } from "effect"

import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { NonEmptyStringSchema, toValidationSchema } from "@/lib/schemas"
import { checkConfigureRequest } from "../-lib/configure-request.server"
import { OperatorKeyInvalid, OperatorLoginRateLimited } from "../-lib/errors"
import {
  clearOperatorLoginRateLimit,
  consumeOperatorLoginRateLimit,
} from "../-lib/login-rate-limit.server"
import { checkOperatorKey } from "../-lib/operator-credentials.server"
import { createOperatorSession, setOperatorSessionCookie } from "../-lib/operator-session.server"

const OperatorLoginInput = Schema.Struct({
  key: NonEmptyStringSchema.pipe(Schema.check(Schema.isMaxLength(1_024))),
})

export const loginOperator = createServerFn({ method: "POST" })
  .validator(toValidationSchema(OperatorLoginInput))
  .handler(({ data, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        yield* checkConfigureRequest()
        const decision = yield* consumeOperatorLoginRateLimit().pipe(Effect.orDie)
        if (!decision.allowed) {
          setResponseHeader("Retry-After", String(decision.retryAfterSeconds))
          return yield* new OperatorLoginRateLimited({
            retryAfterSeconds: decision.retryAfterSeconds,
          })
        }
        if (!checkOperatorKey(data.key)) return yield* new OperatorKeyInvalid()
        yield* clearOperatorLoginRateLimit().pipe(Effect.orDie)
        setOperatorSessionCookie(yield* createOperatorSession())
      }).pipe(
        Effect.catchTag(
          [
            "ConfigureHttpsRequired",
            "ConfigureRequestForbidden",
            "OperatorLoginRateLimited",
            "OperatorKeyInvalid",
          ],
          exposeError,
        ),
      ),
      serverFnMeta.name,
    ),
  )
