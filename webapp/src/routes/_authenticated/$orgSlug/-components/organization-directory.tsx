import { AstralBeamTenantList, AstralBeamTenantUserList } from "@astralbeam/sdk/react"
import { getRouteApi, Link } from "@tanstack/react-router"
import { type CSSProperties, useState } from "react"
import { useTheme } from "tanstack-router-theme-provider"

import { authClient } from "@/lib/auth/client"
import directoryCss from "./organization-directory.css?inline"

const organizationDirectoryRoute = getRouteApi("/_authenticated/$orgSlug")
const directoryThemeTokens = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
]
// Resolve aliases outside the shadow root, where the dashboard owns these tokens.
const directoryThemeStyle = Object.fromEntries(
  directoryThemeTokens.map((token) => [`--directory-${token}`, `var(--${token})`]),
) as CSSProperties
const directoryDashboardTheme = {
  light: {
    ...Object.fromEntries(
      directoryThemeTokens.map((token) => [`--${token}`, `var(--directory-${token})`]),
    ),
    "--radius": "0px",
    "--radius-sm": "0px",
    "--radius-md": "0px",
    "--font-sans": "var(--directory-font-sans)",
    "--font-heading": "var(--directory-font-heading)",
  },
}

export function OrganizationDirectory({ kind }: { kind: "tenants" | "tenant-users" }) {
  const { organization } = organizationDirectoryRoute.useRouteContext()
  const { theme } = useTheme()
  const { data: session, isPending } = authClient.useSession()
  const [missingApiKeys, setMissingApiKeys] = useState(false)
  if (isPending || !session) return null
  const Directory = kind === "tenants" ? AstralBeamTenantList : AstralBeamTenantUserList
  return (
    <div
      className="flex flex-1 flex-col gap-6 p-4 [--directory-font-heading:--theme(--font-heading)] [--directory-font-sans:--theme(--font-sans)] sm:p-6 lg:p-8"
      style={directoryThemeStyle}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {kind === "tenants" ? "Tenants" : "Tenant users"}
        </h1>
      </header>
      <Directory
        key={`${session.user.id}:${organization.organizationId}`}
        apiUrl="/api"
        scope="organization"
        showHeader={false}
        customCss={directoryCss}
        theme={directoryDashboardTheme}
        colorScheme={theme === "dark" || theme === "light" ? theme : "system"}
        fetchAstralBeamToken={async () => {
          setMissingApiKeys(false)
          const response = await fetch("/api/astralbeam/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({
              organizationSlug: organization.organizationSlug,
              scope: "organization",
            }),
          })
          const result = await response.json() as { token: string; error?: string; code?: string }
          if (!response.ok) {
            setMissingApiKeys(result.code === "NO_API_KEYS")
            throw new Error(result.error ?? "Organization token could not be issued")
          }
          return { token: result.token }
        }}
      />
      {missingApiKeys && organization.permissions.readApiKey && (
        <Link
          to="/$orgSlug/api-keys"
          params={{ orgSlug: organization.organizationSlug }}
          className="w-fit text-sm underline underline-offset-4"
        >
          Manage API keys
        </Link>
      )}
    </div>
  )
}
