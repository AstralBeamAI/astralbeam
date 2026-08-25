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
import { type ReactNode, useCallback } from "react"
import { ThemeProvider, useTheme } from "tanstack-router-theme-provider"

import { AuthProvider } from "@/components/auth/auth-provider"
import { PublicConfigProvider } from "@/components/public-config-provider"
import { Toaster } from "@/components/ui/toast"
import { authClient } from "@/lib/auth/client"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { normalizeReturnPath, resolveRedirectOrigin } from "@/lib/auth/redirect"
import { themePlugin } from "@/lib/auth/theme-plugin"
import {
  APP_LOGO_DARK_SVG_URL,
  APP_LOGO_LIGHT_PNG_URL,
  APP_LOGO_LIGHT_SVG_URL,
  APP_NAME,
  AUTH_ALLOWED_RETURN_PATHS,
  DEFAULT_PUBLIC_CONFIG,
  INERT_REDIRECT_ORIGIN,
} from "@/lib/constants"
import appCss from "@/styles.css?url"

import { getPublicConfig } from "./-functions/get-public-config"

const APP_THEMES = ["system", "light", "dark"] as const
type AppTheme = (typeof APP_THEMES)[number]
const devtoolsConfig = { position: "bottom-right" } as const
const devtoolsPlugins = [
  {
    name: "Tanstack Router",
    render: <TanStackRouterDevtoolsPanel />,
  },
]

const getRedirectOrigin = createIsomorphicFn()
  .server(async () => {
    const [{ getConfig }, { getRequest }] = await Promise.all([
      import("@/lib/config.server"),
      import("@tanstack/react-start/server"),
    ])
    const { appBaseUrl } = await getConfig()
    // Requests can carry redirectTo before setup configures the base URL; fall back to the request origin.
    return appBaseUrl ?? new URL(getRequest().url).origin
  })
  .client(() => globalThis.location.origin)

const getSetupComplete = createIsomorphicFn()
  .server(async () => {
    const { getConfig } = await import("@/lib/config.server")
    return (await getConfig()).setupComplete
  })
  // The server gates every document request; client-side navigation within a served app is safe.
  .client(() => true)

function isAppTheme(theme: string): theme is AppTheme {
  return APP_THEMES.some((appTheme) => appTheme === theme)
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  beforeLoad: async ({ location }) => {
    // Until the operator completes setup at /configure, every other page redirects there.
    if (
      !location.pathname.startsWith("/configure") &&
      !(await getSetupComplete())
    ) {
      throw redirect({ to: "/configure", replace: true })
    }

    // Better Auth UI v1.7.12 rereads this query value in the browser, so canonicalize it before its provider renders. https://github.com/better-auth-ui/better-auth-ui/blob/v1.7.12/packages/react/src/components/auth/auth-provider.tsx
    const searchParams = new URLSearchParams(location.searchStr)
    const rawRedirectTo = searchParams.get("redirectTo")
    if (rawRedirectTo === null) return

    const redirectTo = normalizeReturnPath(
      rawRedirectTo,
      await getRedirectOrigin(),
      AUTH_ALLOWED_RETURN_PATHS,
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
  loader: () => getPublicConfig(),
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
  const publicConfig = Route.useLoaderData() ?? DEFAULT_PUBLIC_CONFIG
  const { setTheme, theme } = useTheme()
  const setAppTheme = useCallback(
    (nextTheme: string) => {
      if (isAppTheme(nextTheme)) setTheme(nextTheme)
    },
    [setTheme],
  )
  const searchStr = useLocation({ select: (location) => location.searchStr })
  const origin = resolveRedirectOrigin(
    globalThis.location,
    INERT_REDIRECT_ORIGIN,
  )
  const redirectTo = normalizeReturnPath(
    new URLSearchParams(searchStr).get("redirectTo"),
    origin,
    AUTH_ALLOWED_RETURN_PATHS,
  )

  return (
    <PublicConfigProvider value={publicConfig}>
      <AuthProvider
        authClient={authClient}
        redirectTo={redirectTo}
        socialProviders={publicConfig.enabledSocialProviders}
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
          themePlugin({ setTheme: setAppTheme, theme, themes: [...APP_THEMES] }),
          organizationPlugin({
            localization: { people: "Members" },
            viewPaths: { organization: { people: "members" } },
          }),
        ]}
        Link={({ href, ...props }) => <Link {...props} to={href} />}
      >
        {children}
      </AuthProvider>
    </PublicConfigProvider>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-svh antialiased">
        <ThemeProvider storageKey="theme">
          <Toaster>
            <AppProviders>{children}</AppProviders>
          </Toaster>
          <TanStackDevtools config={devtoolsConfig} plugins={devtoolsPlugins} />
          <Scripts />
        </ThemeProvider>
      </body>
    </html>
  )
}
