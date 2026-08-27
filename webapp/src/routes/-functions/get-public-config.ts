import { createServerFn } from "@tanstack/react-start"

import type { PublicConfig } from "@/lib/types"

export const getPublicConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicConfig | null> => {
    const { getDatabaseBootstrapIssues } = await import(
      "@/db/lib/database-credentials.server"
    )
    if (getDatabaseBootstrapIssues().length > 0) return null
    const { loadPublicConfig } = await import("@/lib/config/state.server")
    return await loadPublicConfig()
  },
)
