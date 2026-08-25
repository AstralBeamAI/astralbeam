import { createServerFn } from "@tanstack/react-start"

import type { PublicConfig } from "@/lib/types"

export const getPublicConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicConfig> => {
    const { getPublicConfigSnapshot } = await import("@/lib/config.server")
    return getPublicConfigSnapshot()
  },
)
