import { createServerFn } from "@tanstack/react-start"
import { setResponseHeader } from "@tanstack/react-start/server"
import { Schema } from "effect"

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
    const { requireConfigureRequest } = await import("../-lib/configure-request.server")
    const { checkOperatorKey } = await import("../-lib/operator-credentials.server")
    const { clearOperatorLoginRateLimit, consumeOperatorLoginRateLimit } = await import(
      "../-lib/login-rate-limit.server"
    )
    const { runDatabaseEffect } = await import("@/db")
    const { createOperatorSession, setOperatorSessionCookie } = await import(
      "../-lib/operator-session.server"
    )
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
