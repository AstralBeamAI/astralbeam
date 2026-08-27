import { TanStackDevtools } from "@tanstack/react-devtools"
import type { QueryClient } from "@tanstack/react-query"
import { captchaPlugin } from "@better-auth-ui/react/plugins/captcha"
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
import { TurnstileCaptcha } from "@/components/auth/turnstile-captcha"
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
    const [{ getGlobalConfig }, { getRequest }] = await Promise.all([
      import("@/lib/config"),
      import("@tanstack/react-start/server"),
    ])
    const appBaseUrl = await getGlobalConfig("app_base_url")
    // Requests can carry redirectTo before setup configures the base URL; fall back to the request origin.
    return appBaseUrl ?? new URL(getRequest().url).origin
  })
  .client(() => globalThis.location.origin)

const getSetupState = createIsomorphicFn()
  .server(async () => {
    const { getDatabaseBootstrapIssues } = await import(
      "@/db/lib/database-credentials.server"
    )
    if (getDatabaseBootstrapIssues().length > 0) return { setupComplete: false }
    const { isSetupComplete } = await import("@/lib/config/state.server")
    return {
      setupComplete: await isSetupComplete(),
    }
  })
  // The server gates every document request; client-side navigation within a served app is safe.
  .client(() => ({ setupComplete: true }))

function isAppTheme(theme: string): theme is AppTheme {
  return APP_THEMES.some((appTheme) => appTheme === theme)
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  beforeLoad: async ({ location }) => {
    const state = await getSetupState()
    const isConfigurePath = location.pathname === "/configure" ||
      location.pathname.startsWith("/configure/")
    if (!state.setupComplete) {
      if (isConfigurePath) return
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
  const publicConfig = Route.useLoaderData()
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

  if (!publicConfig) return children

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
          captchaPlugin({ render: TurnstileCaptcha }),
          themePlugin({ setTheme: setAppTheme, theme, themes: [...APP_THEMES] }),
          organizationPlugin({
            roles: {
              owner: "Owner",
              developer: "Developer",
              viewer: "Viewer",
            },
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
