import { createContext, type ReactNode, useContext } from "react"

import type { PublicConfig } from "@/lib/config/types"

const PublicConfigContext = createContext<PublicConfig | null>(null)

export function PublicConfigProvider({
  value,
  children,
}: {
  value: PublicConfig
  children: ReactNode
}) {
  return <PublicConfigContext.Provider value={value}>{children}</PublicConfigContext.Provider>
}

/** Whether `/` may serve the website, which only a document request reaches. False before setup. */
export function useHasWebsite(): boolean {
  return useContext(PublicConfigContext)?.hasWebsite ?? false
}

export function usePublicConfig(): PublicConfig {
  const value = useContext(PublicConfigContext)
  if (!value) throw new Error("PublicConfigProvider is missing")
  return value
}
