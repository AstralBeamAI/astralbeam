import { createContext } from "react"
import type { AstralBeamChatColorScheme } from "@astralbeam/sdk/react"

export const AppearanceContext = createContext<{
  colorScheme: AstralBeamChatColorScheme
  customTheme: boolean
}>({ colorScheme: "system", customTheme: true })
