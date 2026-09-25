import { createServerFn } from "@tanstack/react-start"

export const logoutOperator = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: boolean }> => {
    const { requireConfigureRequest } = await import("../-lib/configure-request.server")
    const { clearOperatorSessionCookie } = await import("../-lib/operator-session.server")
    requireConfigureRequest()
    clearOperatorSessionCookie()
    return { ok: true }
  },
)
