import { createServerFn } from "@tanstack/react-start"

export interface ApplyConfigChangesResult {
  ok: boolean
  error?: string
}

// Manual revalidation: this instance reloads immediately; others converge within the cache TTL.
export const applyConfigChanges = createServerFn({ method: "POST" }).handler(
  async (): Promise<ApplyConfigChangesResult> => {
    const { getOperatorSession } = await import("../-lib/operator-session.server")
    const { getConfig, invalidateConfigCache } = await import("@/lib/config.server")
    const session = await getOperatorSession()
    if (!session) return { ok: false, error: "Operator authentication required" }
    invalidateConfigCache()
    await getConfig()
    return { ok: true }
  },
)
