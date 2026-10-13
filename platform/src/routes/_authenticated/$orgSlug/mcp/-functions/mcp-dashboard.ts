import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { Auth } from "@/lib/auth/auth.server"
import { Config } from "@/lib/config/config"
import { McpConnections } from "@/lib/mcp/mcp.server"
import { McpAuthorization } from "@/lib/mcp/authorization/authorization"
import { McpTools } from "@/lib/mcp/tools/tools"
import {
  McpConnectionWriteSchema,
  McpManualClientSchema,
  McpPolicySchema,
  McpReferenceSchema,
  McpServerWriteSchema,
  type McpActor,
} from "@/lib/mcp/schemas"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { ServerRequest } from "@/lib/runtime/server-request.server"
import { strictParseOptions, toValidationSchema } from "@/lib/schemas"

const mcpDashboardActionSchema = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("server"),
    id: Schema.NullOr(Schema.String),
    fields: McpServerWriteSchema,
  }),
  Schema.Struct({
    action: Schema.Literal("connection"),
    id: Schema.NullOr(Schema.String),
    fields: McpConnectionWriteSchema,
  }),
  Schema.Struct({ action: Schema.Literal("policy"), policy: McpPolicySchema }),
  Schema.Struct({
    action: Schema.Literal("client"),
    reference: McpReferenceSchema,
    fields: McpManualClientSchema,
  }),
  Schema.Struct({
    action: Schema.Literals(["authorize", "disconnect", "test"]),
    reference: McpReferenceSchema,
  }),
  Schema.Struct({
    action: Schema.Literals(["delete_server", "delete_connection"]),
    reference: McpReferenceSchema,
    lockVersion: Schema.Int,
  }),
  Schema.Struct({
    action: Schema.Literal("bind"),
    reference: McpReferenceSchema,
    challenge: Schema.String,
  }),
  Schema.Struct({ action: Schema.Literal("complete"), reference: McpReferenceSchema }),
])
const mcpDashboardActor = (organizationId: string) =>
  Effect.gen(function* () {
    const headers = (yield* ServerRequest).request.headers
    const session = yield* (yield* Auth).requireSession({ headers })
    return {
      organizationId,
      organizationUserId: session.user.id,
      tenantId: null,
      tenantUserId: null,
      admin: true,
      apiKey: false,
      interactive: true,
    } satisfies McpActor
  })
const mcpDashboardErrors = [
  "McpForbidden",
  "McpNotFound",
  "McpChanged",
  "McpInvalidConfiguration",
  "McpNameTaken",
  "McpAuthorizationRequired",
  "McpUnavailable",
  "SignInRequired",
] as const

export const getMcpDashboardData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(({ context, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const actor = yield* mcpDashboardActor(context.organizationId)
        const service = yield* McpConnections
        const catalog = yield* service.catalog(actor)
        const baseUrl = yield* (yield* Config).get("app_base_url")
        return {
          ...catalog,
          permissions: context.permissions,
          callbackUri: baseUrl ? new URL("/api/mcp/oauth/callback", baseUrl).href : null,
        }
      }).pipe(Effect.catchTag("SignInRequired", exposeError)),
      serverFnMeta.name,
    ),
  )

export const mutateMcpDashboard = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(
    toValidationSchema(
      Schema.Struct({
        ...OrganizationRouteInputSchema.fields,
        operation: mcpDashboardActionSchema,
      }),
      strictParseOptions,
    ),
  )
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const actor = yield* mcpDashboardActor(context.organizationId)
        const service = yield* McpConnections
        const authority = yield* McpAuthorization
        const operation = data.operation
        const owner = { organizationId: actor.organizationId, tenantId: null, tenantUserId: null }
        switch (operation.action) {
          case "server":
            return yield* service.saveServer({
              actor,
              owner,
              id: operation.id ?? undefined,
              fields: operation.fields,
            })
          case "connection":
            return yield* service.saveConnection({
              actor,
              owner,
              id: operation.id ?? undefined,
              fields: operation.fields,
            })
          case "policy":
            return yield* service.savePolicy({ actor, policy: operation.policy })
          case "client":
            return yield* authority.configureClient({
              actor,
              reference: operation.reference,
              manualClient: operation.fields,
            })
          case "authorize":
            return yield* authority.start({ actor, reference: operation.reference })
          case "disconnect":
            return yield* service.disconnect({ actor, reference: operation.reference })
          case "test":
            return yield* (yield* McpTools).test({ actor, reference: operation.reference })
          case "delete_server":
          case "delete_connection":
            return yield* service.remove({
              actor,
              reference: operation.reference,
              kind: operation.action === "delete_server" ? "server" : "connection",
              lockVersion: operation.lockVersion,
            })
          case "bind":
            return yield* authority.bindBrowser({
              actor,
              reference: operation.reference,
              challenge: operation.challenge,
            })
          case "complete":
            return yield* authority.complete({ actor, reference: operation.reference })
        }
      }).pipe(Effect.catchTag(mcpDashboardErrors, exposeError)),
      serverFnMeta.name,
    ),
  )
