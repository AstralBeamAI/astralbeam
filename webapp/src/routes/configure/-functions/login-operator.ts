import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"

const LoginOperatorInput = Schema.Struct({
  username: Schema.NonEmptyString,
  password: Schema.NonEmptyString,
})

export interface LoginOperatorResult {
  ok: boolean
  error?: string
}

export const loginOperator = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(LoginOperatorInput))
  .handler(async ({ data }): Promise<LoginOperatorResult> => {
    const { checkOperatorCredentials, isLoginThrottled, recordLoginFailure } = await import(
      "../-lib/operator-credentials.server"
    )
    const { createOperatorSession, setOperatorSessionCookie } = await import(
      "../-lib/operator-session.server"
    )
    const { getRequest } = await import("@tanstack/react-start/server")
    const source = getRequest().headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
    if (isLoginThrottled(source)) {
      return { ok: false, error: "Too many login attempts; try again in a minute." }
    }
    const check = checkOperatorCredentials(data.username, data.password)
    if (check === "no-password") {
      return {
        ok: false,
        error:
          "Operator login requires a password in the DATABASE_URL connection string of this deployment.",
      }
    }
    if (check === "invalid") {
      recordLoginFailure(source)
      return { ok: false, error: "Invalid database credentials" }
    }
    const token = await createOperatorSession(data.username)
    setOperatorSessionCookie(token)
    return { ok: true }
  })
