// Added with: deno task ui add @better-auth-ui/organization
// Local changes: Keep generated plugin implementation types module-private.

import type { AuthPlugin as AuthPluginPrimitive, AuthPluginComponents } from "@better-auth-ui/react"

declare module "@better-auth-ui/core" {
  /** Widens `useAuth().plugins` to the shadcn-typed `AuthPlugin`. */
  interface AuthPluginRegister {
    shadcn: AuthPlugin
  }
}

/** Props the shadcn `<Auth>` router spreads onto plugin-contributed auth views. */
type AuthViewProps = {
  className?: string
  socialLayout?: "auto" | "horizontal" | "vertical" | "grid"
  socialPosition?: "top" | "bottom"
}

/** Props the shadcn `<Settings>` router spreads onto plugin-contributed settings views. */
type SettingsViewProps = {
  className?: string
}

/** Shadcn plugin type registered with Better Auth UI's module augmentation. */
type AuthPlugin = AuthPluginPrimitive<
  AuthPluginComponents,
  AuthViewProps,
  SettingsViewProps
>
