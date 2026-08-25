// Added with: deno task ui add @better-auth-ui/auth
// Local changes: Inject the Base UI Toast error handler and remove unused custom-field typing.

import {
  AuthProvider as AuthProviderPrimitive,
  type AuthProviderProps,
} from "@better-auth-ui/react"
import type { ComponentPropsWithoutRef, ComponentType, PropsWithChildren } from "react"

import { ErrorToaster } from "./error-toaster"

declare module "@better-auth-ui/core" {
  interface AuthConfig {
    /**
     * React component used to render internal navigation links.
     * Typically TanStack Router's `Link` or Next.js's `Link`.
     */
    Link: ComponentType<
      PropsWithChildren<
        & { className?: string; href: string; to?: string }
        & Pick<
          ComponentPropsWithoutRef<"a">,
          "aria-disabled" | "tabIndex" | "onClick"
        >
      >
    >
  }
}

/**
 * Provides an authentication context with the Base UI Toast error handler,
 * forwarding the remaining configuration and rendering `children` inside it.
 *
 * @param children - React nodes to render inside the authentication provider
 * @returns A React element that renders an authentication provider configured with the provided props and toast handler
 */
export function AuthProvider({ children, ...config }: AuthProviderProps) {
  return (
    <AuthProviderPrimitive {...config}>
      {children}

      <ErrorToaster />
    </AuthProviderPrimitive>
  )
}
