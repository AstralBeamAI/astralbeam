import { createServerFn } from "@tanstack/react-start"

import { loadPublicConfig } from "@/lib/config/state.server"
import { getDatabaseBootstrapIssues } from "@/db/lib/database-credentials.server"
import type { PublicConfig } from "@/lib/config/types"

export const getPublicConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicConfig | null> => {
    if (getDatabaseBootstrapIssues().length > 0) return null
    return await loadPublicConfig()
  },
)
