import { TanStackDevtools } from "@tanstack/react-devtools"
import type { QueryClient } from "@tanstack/react-query"
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  redirect,
  Scripts,
  useLocation,
  useNavigate,
} from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { createIsomorphicFn } from "@tanstack/react-start"
import type { ReactNode } from "react"

import { AuthProvider } from "@/components/auth/auth-provider"
import { Toaster } from "@/components/ui/toast"
import { APP_THEMES, useAppTheme } from "@/hooks/use-app-theme"
import { authClient } from "@/lib/auth/client"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { normalizeReturnPath, resolveRedirectOrigin } from "@/lib/auth/redirect"
import { themePlugin } from "@/lib/auth/theme-plugin"
import {
  APP_LOGO_DARK_SVG_URL,
  APP_LOGO_LIGHT_PNG_URL,
  APP_LOGO_LIGHT_SVG_URL,
  APP_NAME,
  INERT_REDIRECT_ORIGIN,
} from "@/lib/config"
import appCss from "@/styles.css?url"

// Route-managed styles load through the document head; the saved theme is applied after hydration
// so the server and client render the same initial markup. https://tanstack.com/router/latest/docs/guide/document-head-management
const ALLOWED_AUTH_RETURN_PATHS = ["/auth/accept-invitation"] as const
const devtoolsConfig = { position: "bottom-right" } as const
const devtoolsPlugins = [
  {
    name: "Tanstack Router",
    render: <TanStackRouterDevtoolsPanel />,
  },
]

const getRedirectOrigin = createIsomorphicFn()
  .server(async () => {
    const { APP_BASE_URL } = await import("@/lib/config.server")
    return APP_BASE_URL
  })
  .client(() => globalThis.location.origin)

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  beforeLoad: async ({ location }) => {
    // Better Auth UI v1.7.12 rereads this query value in the browser, so canonicalize it before its provider renders. https://github.com/better-auth-ui/better-auth-ui/blob/v1.7.12/packages/react/src/components/auth/auth-provider.tsx
    const searchParams = new URLSearchParams(location.searchStr)
    const rawRedirectTo = searchParams.get("redirectTo")
    if (rawRedirectTo === null) return

    const redirectTo = normalizeReturnPath(
      rawRedirectTo,
      await getRedirectOrigin(),
      ALLOWED_AUTH_RETURN_PATHS,
    )

    if (
      rawRedirectTo === redirectTo &&
      searchParams.getAll("redirectTo").length === 1
    ) {
      return
    }

    searchParams.set("redirectTo", redirectTo)
    const search = `?${searchParams}`
    const hash = location.hash ? `#${location.hash}` : ""
    throw redirect({
      href: `${location.pathname}${search}${hash}`,
      replace: true,
    })
  },
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: APP_NAME,
      },
    ],
    links: [
      {
        rel: "icon",
        type: "image/png",
        href: APP_LOGO_LIGHT_PNG_URL,
        sizes: "270x270",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: APP_LOGO_LIGHT_SVG_URL,
        media: "(prefers-color-scheme: light)",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: APP_LOGO_DARK_SVG_URL,
        media: "(prefers-color-scheme: dark)",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "license",
        href: "/LICENSE-AGPL",
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

function AppProviders({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { setTheme, theme } = useAppTheme()
  const searchStr = useLocation({ select: (location) => location.searchStr })
  const origin = resolveRedirectOrigin(
    globalThis.location,
    INERT_REDIRECT_ORIGIN,
  )
  const redirectTo = normalizeReturnPath(
    new URLSearchParams(searchStr).get("redirectTo"),
    origin,
    ALLOWED_AUTH_RETURN_PATHS,
  )

  return (
    <AuthProvider
      authClient={authClient}
      redirectTo={redirectTo}
      socialProviders={["google", "github"]}
      emailAndPassword={{
        enabled: true,
        confirmPassword: true,
        forgotPassword: true,
        maxPasswordLength: 128,
        minPasswordLength: 12,
        requireEmailVerification: true,
        strengthMeter: true,
      }}
      localization={{
        auth: {
          callbackAccountLinkConflictTitle: "This provider is linked to another account",
          callbackAccountLinkConflictDescription:
            "Sign in to the account that owns this provider, add another sign-in method if needed, unlink it in Security, then return and link it here.",
        },
      }}
      multipleAccountsPerProvider={false}
      navigate={navigate}
      plugins={[
        themePlugin({ setTheme, theme, themes: [...APP_THEMES] }),
        organizationPlugin({
          localization: { people: "Members" },
          viewPaths: { organization: { people: "members" } },
        }),
      ]}
      Link={({ href, ...props }) => <Link {...props} to={href} />}
    >
      {children}
    </AuthProvider>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-svh antialiased">
        <Toaster>
          <AppProviders>{children}</AppProviders>
        </Toaster>
        <TanStackDevtools config={devtoolsConfig} plugins={devtoolsPlugins} />
        <Scripts />
      </body>
    </html>
  )
}
