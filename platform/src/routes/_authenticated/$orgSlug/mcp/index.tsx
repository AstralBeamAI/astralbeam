import { AstralBeamMcpServers, type AstralBeamMcpServersProps } from "@astralbeam/sdk/react"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import { Result, Schema, SchemaIssue } from "effect"
import { useTheme } from "tanstack-router-theme-provider"
import { APP_NAME } from "@/lib/constants"
import { DocsLink } from "@/components/docs-link"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import { McpServerWriteSchema } from "@/lib/mcp/schemas"
import { validationParseOptions } from "@/lib/schemas"
import {
  widgetDashboardTheme,
  widgetThemeClassName,
  widgetThemeStyle,
} from "../../-lib/widget-theme"
import { getMcpServersData, mutateMcpServer } from "./-functions/mcp-dashboard"

export const Route = createFileRoute("/_authenticated/$orgSlug/mcp/")({
  beforeLoad: ({ context, params }) => {
    if (!context.organization.permissions.readConfiguration)
      throw redirect({ to: "/$orgSlug", params, replace: true })
  },
  loader: ({ params }) => getMcpServersData({ data: { organizationSlug: params.orgSlug } }),
  component: McpDashboardPage,
  head: () => ({ meta: [{ title: `MCP servers · ${APP_NAME}` }] }),
})
const formatMcpServerIssues = SchemaIssue.makeFormatterStandardSchemaV1()
function McpDashboardPage() {
  const { orgSlug } = Route.useParams()
  const data = Route.useLoaderData()
  const { access, organization } = Route.useRouteContext()
  const router = useRouter()
  const { theme } = useTheme()
  const mutate = async (operation: Parameters<typeof mutateMcpServer>[0]["data"]["operation"]) => {
    try {
      await mutateMcpServer({ data: { organizationSlug: orgSlug, operation } })
      await router.invalidate()
    } catch (failure) {
      throw new Error(parseServerFnError(failure).message)
    }
  }
  const create: NonNullable<AstralBeamMcpServersProps["onCreateServer"]> = async (fields) => {
    const parsed = Schema.decodeUnknownResult(McpServerWriteSchema, validationParseOptions)(fields)
    if (Result.isFailure(parsed))
      return {
        errors: formatMcpServerIssues(parsed.failure.issue).issues.map((issue) => ({
          field: String(issue.path?.findLast((part) => typeof part === "string") ?? "endpointUrl"),
          message: issue.message,
        })),
      }
    return mutate({ action: "create_server", fields: parsed.success })
  }
  return (
    <div
      className={`flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8 ${widgetThemeClassName}`}
      style={widgetThemeStyle}
    >
      <div>
        <h1 className="text-2xl font-semibold">MCP servers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Make remote tools available to your embedded agents.{" "}
          <DocsLink href="/docs/dashboard/connections#add-a-server-and-connect">
            Server and OAuth setup
          </DocsLink>
        </p>
      </div>
      <AstralBeamMcpServers
        className="max-w-2xl"
        key={`${access.userId}:${organization.organizationId}`}
        servers={data.servers}
        oauthRedirectUri={data.callbackUri}
        onCreateServer={data.permissions.updateConfiguration ? create : undefined}
        onRemoveServer={
          data.permissions.updateConfiguration
            ? (id) => mutate({ action: "delete_server", id })
            : undefined
        }
        theme={widgetDashboardTheme}
        colorScheme={theme === "dark" || theme === "light" ? theme : "system"}
      />
    </div>
  )
}
