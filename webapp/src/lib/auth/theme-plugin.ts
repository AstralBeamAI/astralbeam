// Added with: deno task ui add @better-auth-ui/theme
// Local changes: Register the ejected UI slots while preserving Better Auth UI's static theme API.

import { createAuthPlugin } from "@better-auth-ui/core"
import {
  themePlugin as coreThemePlugin,
  type ThemePluginOptions,
} from "@better-auth-ui/core/plugins/theme"

import { Appearance } from "@/components/auth/theme/appearance"
import { ThemeToggleItem } from "@/components/auth/theme/theme-toggle-item"

export const themePlugin = createAuthPlugin(
  coreThemePlugin.id,
  (options: ThemePluginOptions) => ({
    ...coreThemePlugin(options),
    userMenuItems: [ThemeToggleItem],
    accountCards: [Appearance],
  }),
)
