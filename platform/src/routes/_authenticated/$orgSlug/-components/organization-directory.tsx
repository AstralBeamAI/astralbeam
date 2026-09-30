import { AstralBeamTenantList, AstralBeamTenantUserList } from "@astralbeam/sdk/react"
import { getRouteApi, Link } from "@tanstack/react-router"
import { useState } from "react"
import { useTheme } from "tanstack-router-theme-provider"
import { cn } from "cn"

import {
  widgetDashboardTheme,
  widgetThemeClassName,
  widgetThemeStyle,
} from "../../-lib/widget-theme"
import directoryCss from "./organization-directory.css?inline"

const organizationDirectoryRoute = getRouteApi("/_authenticated/$orgSlug")
export function OrganizationDirectory({ kind }: { kind: "tenants" | "tenant-users" }) {
  const { access, organization } = organizationDirectoryRoute.useRouteContext()
  const { theme } = useTheme()
  const [missingApiKeys, setMissingApiKeys] = useState(false)
  const Directory = kind === "tenants" ? AstralBeamTenantList : AstralBeamTenantUserList
  return (
    <div
      className={cn("flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8", widgetThemeClassName)}
      style={widgetThemeStyle}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {kind === "tenants" ? "Tenants" : "Tenant users"}
        </h1>
      </header>
      <Directory
        key={`${access.userId}:${organization.organizationId}`}
        apiUrl="/api"
        scope="organization"
        showHeader={false}
        customCss={directoryCss}
        theme={widgetDashboardTheme}
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
          const result = (await response.json()) as { token: string; error?: string; code?: string }
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
