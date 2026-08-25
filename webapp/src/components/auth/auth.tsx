// Added with: deno task ui add @better-auth-ui/auth
// Local changes: Preserve exact optional-property typing and remove unconfigured passwordless fallback routing.

"use client"

import type { AuthView } from "@better-auth-ui/core"
import { useAuth } from "@better-auth-ui/react"
import type { ComponentType } from "react"

import { AuthRedirect } from "./auth-redirect"
import { AuthCallback, AuthError } from "./auth-result"
import { ForgotPassword } from "./forgot-password"
import type { SocialLayout } from "./provider-buttons"
import { ResetLinkSent } from "./reset-link-sent"
import { ResetPassword } from "./reset-password"
import { SignIn } from "./sign-in"
import { SignOut } from "./sign-out"
import { SignUp } from "./sign-up"
import { VerifyEmail } from "./verify-email"

export type AuthProps = {
  className?: string
  path?: string
  socialLayout?: SocialLayout
  socialPosition?: "top" | "bottom"
  /** @remarks `AuthView` */
  view?: AuthView
}

const AUTH_VIEWS: Partial<Record<AuthView, ComponentType<AuthProps>>> = {
  callback: AuthCallback,
  error: AuthError,
  redirect: AuthRedirect,
  signIn: SignIn,
  signOut: SignOut,
  signUp: SignUp,
  forgotPassword: ForgotPassword,
  resetPassword: ResetPassword,
  resetLinkSent: ResetLinkSent,
  verifyEmail: VerifyEmail,
}

/**
 * Render the appropriate authentication view based on the provided `view` or `path`.
 *
 * Resolution order:
 *   1. Plugin overrides (`plugin.views.auth[currentView]`) — first registered wins.
 *   2. Built-in views.
 *
 * @param path - Route path used to resolve an auth view when `view` is not provided
 * @param socialLayout - Social layout to apply to sign-in and sign-up views
 * @param socialPosition - Position for social buttons (`"top"` or `"bottom"`)
 * @param view - Explicit auth view to render (e.g., `"signIn"`, `"signUp"`)
 * @returns The React element for the resolved authentication view
 */
export function Auth({
  className,
  path,
  socialLayout,
  socialPosition,
  view,
}: AuthProps) {
  const { plugins, viewPaths } = useAuth()

  if (!view && !path) {
    throw new Error("[Better Auth UI] Either `view` or `path` must be provided")
  }

  const authViewProps = {
    ...(className === undefined ? {} : { className }),
    ...(socialLayout === undefined ? {} : { socialLayout }),
    ...(socialPosition === undefined ? {} : { socialPosition }),
  }

  const authView = view ||
    (Object.keys(viewPaths.auth) as AuthView[]).find(
      (key) => viewPaths.auth[key] === path,
    )

  // 1. Plugin overrides (`views.auth[currentView]`) — first plugin wins,
  //    including over built-in views. Resolves the view key from `view`,
  //    then `authView` (built-in path match), then plugin-introduced paths.
  for (const plugin of plugins) {
    const pluginAuthPaths = plugin.viewPaths?.auth

    const pluginView = view ??
      authView ??
      (pluginAuthPaths &&
        Object.keys(pluginAuthPaths).find(
          (key) => pluginAuthPaths[key] === path,
        ))
    if (!pluginView) continue

    const PluginView = plugin.views?.auth?.[pluginView]
    if (!PluginView) continue

    return <PluginView {...authViewProps} />
  }

  const AuthView = authView ? AUTH_VIEWS[authView] : undefined

  if (!AuthView) {
    throw new Error(
      `[Better Auth UI] Unknown view "${authView}". Valid views are: ${
        Object.keys(AUTH_VIEWS).join(", ")
      }`,
    )
  }

  return <AuthView {...authViewProps} />
}
