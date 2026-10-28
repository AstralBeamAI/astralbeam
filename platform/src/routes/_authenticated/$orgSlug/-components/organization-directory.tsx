import {
  AstralBeamThreadList,
  AstralBeamTenantList,
  AstralBeamTenantUserList,
} from "@astralbeam/sdk/react"
import { getRouteApi, Link } from "@tanstack/react-router"
import { useContext, useState } from "react"
import { useTheme } from "tanstack-router-theme-provider"
import { cn } from "cn"

import { DocsLink } from "@/components/docs-link"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  widgetDashboardTheme,
  widgetThemeClassName,
  widgetThemeStyle,
} from "../../-lib/widget-theme"
import directoryCss from "./organization-directory.css?inline"
import { DirectoryCacheContext } from "../../-lib/directory-cache"

const organizationDirectoryRoute = getRouteApi("/_authenticated/$orgSlug")
export function OrganizationDirectory({ kind }: { kind: "tenants" | "tenant-users" | "threads" }) {
  const { access, organization } = organizationDirectoryRoute.useRouteContext()
  const cacheKey = useContext(DirectoryCacheContext)
  const { theme } = useTheme()
  const [missingApiKeys, setMissingApiKeys] = useState(false)
  const Directory =
    kind === "threads"
      ? AstralBeamThreadList
      : kind === "tenants"
        ? AstralBeamTenantList
        : AstralBeamTenantUserList
  return (
    <div
      className={cn("@container/organization-directory flex min-w-0 flex-1", widgetThemeClassName)}
      style={widgetThemeStyle}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 @lg/organization-directory:p-6 @4xl/organization-directory:p-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight @lg/organization-directory:text-3xl">
              {kind === "threads"
                ? "Conversations"
                : kind === "tenants"
                  ? "Tenants"
                  : "Tenant users"}
            </h1>
            <p className="max-w-prose text-sm text-muted-foreground">
              {kind === "threads"
                ? "Browse conversations saved by the agents in your app."
                : kind === "tenants"
                  ? "Your app’s customer accounts. Records appear when your app connects them through the SDK or API."
                  : "The people who use your embedded agents. These are your customers’ users, separate from your dashboard members."}
            </p>
          </div>
          <DocsLink
            href={
              kind === "threads"
                ? "/docs/sdk/listings#browse-saved-conversations"
                : "/docs/sdk/listings#from-records-to-a-working-directory"
            }
            className="text-sm"
          >
            {kind === "threads"
              ? "How saved conversations work"
              : "How tenant records are populated"}
          </DocsLink>
        </header>
        {missingApiKeys ? (
          <Empty className="max-w-4xl flex-none border">
            <EmptyHeader>
              <EmptyTitle>Finish organization setup</EmptyTitle>
              <EmptyDescription>
                {organization.permissions.createApiKey
                  ? "Create an active API key for this organization to load customer activity."
                  : "Ask an owner or developer to create an active API key for this organization, then try again."}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row flex-wrap justify-center">
              {organization.permissions.readApiKey && (
                <Link
                  to="/$orgSlug/api-keys"
                  params={{ orgSlug: organization.organizationSlug }}
                  className={buttonVariants({ size: "sm" })}
                >
                  Manage API keys
                </Link>
              )}
              <Button size="sm" variant="outline" onClick={() => setMissingApiKeys(false)}>
                Try again
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Directory
            key={`${access.userId}:${organization.organizationId}`}
            cacheKey={cacheKey}
            apiUrl="/api"
            scope="organization"
            showHeader={false}
            customCss={directoryCss}
            theme={widgetDashboardTheme}
            colorScheme={theme === "dark" || theme === "light" ? theme : "system"}
            fetchAstralBeamToken={async () => {
              const response = await fetch("/api/astralbeam/token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
                body: JSON.stringify({
                  organizationSlug: organization.organizationSlug,
                  scope: "organization",
                }),
              })
              const result = (await response.json()) as {
                token: string
                error?: string
                code?: string
              }
              if (!response.ok) {
                setMissingApiKeys(result.code === "NO_API_KEYS")
                throw new Error(result.error ?? "Organization token could not be issued")
              }
              return { token: result.token }
            }}
          />
        )}
      </div>
    </div>
  )
}
