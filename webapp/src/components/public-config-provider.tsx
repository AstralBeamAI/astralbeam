import { createContext, type ReactNode, useContext } from "react"

import { DEFAULT_PUBLIC_CONFIG } from "@/lib/constants"
import type { PublicConfig } from "@/lib/types"

const PublicConfigContext = createContext<PublicConfig>(DEFAULT_PUBLIC_CONFIG)

export function PublicConfigProvider(
  { value, children }: { value: PublicConfig; children: ReactNode },
) {
  return <PublicConfigContext.Provider value={value}>{children}</PublicConfigContext.Provider>
}

export function usePublicConfig(): PublicConfig {
  return useContext(PublicConfigContext)
}
