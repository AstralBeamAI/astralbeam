import { createServerFn } from "@tanstack/react-start"

export const logoutOperator = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: boolean }> => {
    const { clearOperatorSessionCookie, destroyOperatorSession, operatorSessionToken } =
      await import("../-lib/operator-session.server")
    await destroyOperatorSession(operatorSessionToken())
    clearOperatorSessionCookie()
    return { ok: true }
  },
)
