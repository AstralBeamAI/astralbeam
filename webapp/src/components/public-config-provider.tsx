import { createContext, type ReactNode, useContext } from "react"

import type { PublicConfig } from "@/lib/types"

const PublicConfigContext = createContext<PublicConfig | null>(null)

export function PublicConfigProvider(
  { value, children }: { value: PublicConfig; children: ReactNode },
) {
  return <PublicConfigContext.Provider value={value}>{children}</PublicConfigContext.Provider>
}

export function usePublicConfig(): PublicConfig {
  const value = useContext(PublicConfigContext)
  if (!value) throw new Error("PublicConfigProvider is missing")
  return value
}
