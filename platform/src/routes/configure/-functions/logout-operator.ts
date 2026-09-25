import { createServerFn } from "@tanstack/react-start"

import { requireConfigureRequest } from "../-lib/configure-request.server"
import { clearOperatorSessionCookie } from "../-lib/operator-session.server"

export const logoutOperator = createServerFn({ method: "POST" }).handler((): { ok: boolean } => {
  requireConfigureRequest()
  clearOperatorSessionCookie()
  return { ok: true }
})
