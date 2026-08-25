import { createServerFn } from "@tanstack/react-start"

import { getPublicConfigSnapshot } from "@/lib/config.server"
import type { PublicConfig } from "@/lib/types"

export const getPublicConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicConfig> => getPublicConfigSnapshot(),
)
