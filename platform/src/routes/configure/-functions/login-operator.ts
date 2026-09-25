import { createServerFn } from "@tanstack/react-start"
import { setResponseHeader } from "@tanstack/react-start/server"
import { Schema } from "effect"

import {
  clearOperatorLoginRateLimit,
  consumeOperatorLoginRateLimit,
} from "../-lib/login-rate-limit.server"
import { runDatabaseEffect } from "@/db"
import { requireConfigureRequest } from "../-lib/configure-request.server"
import { checkOperatorKey } from "../-lib/operator-credentials.server"
import { createOperatorSession, setOperatorSessionCookie } from "../-lib/operator-session.server"

const OperatorLoginInput = Schema.Struct({
  key: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(1_024))),
})

interface OperatorLoginResult {
  ok: boolean
  error?: string
}

export const loginOperator = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(OperatorLoginInput))
  .handler(async ({ data }): Promise<OperatorLoginResult> => {
    requireConfigureRequest()
    const decision = await runDatabaseEffect(consumeOperatorLoginRateLimit())
    if (!decision.allowed) {
      setResponseHeader("Retry-After", String(decision.retryAfterSeconds))
      return {
        ok: false,
        error: `Too many sign-in attempts; try again in ${decision.retryAfterSeconds} seconds.`,
      }
    }
    if (checkOperatorKey(data.key)) {
      await runDatabaseEffect(clearOperatorLoginRateLimit())
      setOperatorSessionCookie(await createOperatorSession())
      return { ok: true }
    }
    return { ok: false, error: "Invalid encryption key" }
  })
