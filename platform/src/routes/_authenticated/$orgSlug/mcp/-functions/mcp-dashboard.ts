import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { Config } from "@/lib/config/config"
import { McpConnections } from "@/lib/mcp/mcp.server"
import { McpServerWriteSchema } from "@/lib/mcp/schemas"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"

export const getMcpDashboardData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(({ context, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const servers = yield* (yield* McpConnections).listServers(context.organizationId)
        const baseUrl = yield* (yield* Config).get("app_base_url")
        return {
          servers,
          permissions: context.permissions,
          callbackUri: baseUrl ? new URL("/api/mcp/oauth/callback", baseUrl).href : null,
        }
      }),
      serverFnMeta.name,
    ),
  )
export const mutateMcpDashboard = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(
    toValidationSchema(
      Schema.Struct({
        ...OrganizationRouteInputSchema.fields,
        operation: Schema.Union([
          Schema.Struct({ action: Schema.Literal("server"), fields: McpServerWriteSchema }),
          Schema.Struct({
            action: Schema.Literal("delete_server"),
            id: Schema.String.check(Schema.isUUID(7)),
          }),
        ]),
      }),
    ),
  )
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const service = yield* McpConnections
        return data.operation.action === "server"
          ? yield* service.createServer(context.organizationId, data.operation.fields)
          : yield* service.removeServer(context.organizationId, data.operation.id)
      }).pipe(
        Effect.catchTag(["McpChanged", "McpInvalidConfiguration", "McpNotFound"], exposeError),
      ),
      serverFnMeta.name,
    ),
  )
