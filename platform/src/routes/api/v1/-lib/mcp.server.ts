import { Effect, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import type { ApiV1 } from "./contract.server"
import { ApiUuidSchema } from "../../../../lib/tenants/schemas.ts"
import {
  McpAttemptReferenceSchema,
  McpConnectionSummarySchema,
  McpConnectionWriteSchema,
  McpHeadersWriteSchema,
  McpServerSummarySchema,
} from "../../../../lib/mcp/schemas.ts"

const mcpWireKeys = {
  organizationId: "organization_id",
  tenantId: "tenant_id",
  serverId: "server_id",
  connectionId: "connection_id",
  endpointUrl: "endpoint_url",
  authKind: "auth_kind",
  headerNames: "header_names",
  authState: "auth_state",
  lockVersion: "lock_version",
} as const
const McpRestServer = McpServerSummarySchema.pipe(Schema.encodeKeys(mcpWireKeys)).annotate({
  identifier: "McpServer",
})
const McpRestConnection = McpConnectionSummarySchema.pipe(Schema.encodeKeys(mcpWireKeys)).annotate({
  identifier: "McpConnection",
})
const mcpPersonalParams = Schema.Struct({ id: ApiUuidSchema })
const mcpAttemptBody = Schema.Struct({ attemptId: ApiUuidSchema }).pipe(
  Schema.encodeKeys({ attemptId: "attempt_id" }),
)
export const personalMcpApi = HttpApiGroup.make("personalMcp")
  .annotateEndpoints(OpenApi.Override, { security: [{ astralBeamToken: [] }] })
  .add(
    HttpApiEndpoint.get("getCatalog", "/me/mcp/catalog", {
      success: Schema.Struct({
        servers: Schema.Array(McpRestServer),
        connections: Schema.Array(McpRestConnection),
      }),
    }),
    HttpApiEndpoint.post("createConnection", "/me/mcp/connections", {
      payload: McpConnectionWriteSchema.pipe(Schema.encodeKeys(mcpWireKeys)),
      success: McpRestConnection,
    }),
    HttpApiEndpoint.delete("deleteConnection", "/me/mcp/connections/:id", {
      params: mcpPersonalParams,
    }),
    HttpApiEndpoint.post("setHeaders", "/me/mcp/connections/:id/headers", {
      params: mcpPersonalParams,
      payload: McpHeadersWriteSchema.pipe(Schema.encodeKeys(mcpWireKeys)),
    }),
    HttpApiEndpoint.post("disconnectConnection", "/me/mcp/connections/:id/disconnect", {
      params: mcpPersonalParams,
    }),
    HttpApiEndpoint.post("testConnection", "/me/mcp/connections/:id/test", {
      params: mcpPersonalParams,
      success: Schema.Struct({ toolCount: Schema.Int }).pipe(
        Schema.encodeKeys({ toolCount: "tool_count" }),
      ),
    }),
    HttpApiEndpoint.post("authorizeConnection", "/me/mcp/connections/:id/authorize", {
      params: mcpPersonalParams,
      success: Schema.Struct({
        attempt: McpAttemptReferenceSchema.pipe(Schema.encodeKeys(mcpWireKeys)),
        popupUrl: Schema.String,
      }).pipe(Schema.encodeKeys({ popupUrl: "popup_url" })),
    }),
    HttpApiEndpoint.post("bindBrowser", "/me/mcp/connections/:id/oauth/bind", {
      params: mcpPersonalParams,
      payload: Schema.Struct({ attemptId: ApiUuidSchema, challenge: Schema.String }).pipe(
        Schema.encodeKeys({ attemptId: "attempt_id" }),
      ),
    }),
    HttpApiEndpoint.post("completeAuthorization", "/me/mcp/connections/:id/oauth/complete", {
      params: mcpPersonalParams,
      payload: mcpAttemptBody,
    }),
  )
export function personalMcpHandlers(api: typeof ApiV1) {
  return HttpApiBuilder.group(
    api,
    "personalMcp",
    Effect.fn("personalMcpHandlers")(function* (handlers) {
      const { McpConnections } = yield* Effect.promise(() => import("@/lib/mcp/mcp.server"))
      const { McpAuthorization } = yield* Effect.promise(
        () => import("@/lib/mcp/authorization/authorization"),
      )
      const { McpTools } = yield* Effect.promise(() => import("@/lib/mcp/tools/tools"))
      const { authenticateMcpRequest } = yield* Effect.promise(() => import("./mcp-auth.server"))
      const connections = yield* McpConnections
      const authorization = yield* McpAuthorization
      const tools = yield* McpTools
      const context =
        yield* Effect.context<Effect.Services<ReturnType<typeof authenticateMcpRequest>>>()
      const actorFor = (request: HttpServerRequest.HttpServerRequest) =>
        HttpServerRequest.toWeb(request).pipe(
          Effect.orDie,
          Effect.flatMap(authenticateMcpRequest),
          Effect.provideContext(context),
        )
      const accessFor = Effect.fnUntraced(function* (
        request: HttpServerRequest.HttpServerRequest,
        id: string,
      ) {
        const actor = yield* actorFor(request)
        return {
          actor,
          reference: { organizationId: actor.organizationId, tenantId: actor.tenantId, id },
        }
      })
      return handlers
        .handle(
          "getCatalog",
          Effect.fn("mcpGetCatalog")(function* ({ request }) {
            return yield* connections.catalog(yield* actorFor(request))
          }),
        )
        .handle(
          "createConnection",
          Effect.fn("mcpCreateConnection")(function* ({ request, payload }) {
            return yield* connections.createConnection(yield* actorFor(request), payload.serverId)
          }),
        )
        .handle(
          "deleteConnection",
          Effect.fn("mcpDeleteConnection")(function* ({ request, params }) {
            const access = yield* accessFor(request, params.id)
            yield* authorization.disconnect(access)
            yield* connections.removeConnection(access)
          }),
        )
        .handle(
          "setHeaders",
          Effect.fn("mcpSetHeaders")(function* ({ request, params, payload }) {
            yield* connections.setHeaders({ ...(yield* accessFor(request, params.id)), ...payload })
          }),
        )
        .handle(
          "disconnectConnection",
          Effect.fn("mcpDisconnectConnection")(function* ({ request, params }) {
            yield* authorization.disconnect(yield* accessFor(request, params.id))
          }),
        )
        .handle(
          "testConnection",
          Effect.fn("mcpTestConnection")(function* ({ request, params }) {
            return yield* tools.test(yield* accessFor(request, params.id))
          }),
        )
        .handle(
          "authorizeConnection",
          Effect.fn("mcpAuthorizeConnection")(function* ({ request, params }) {
            return yield* authorization.start(yield* accessFor(request, params.id))
          }),
        )
        .handle(
          "bindBrowser",
          Effect.fn("mcpBindBrowser")(function* ({ request, params, payload }) {
            const access = yield* accessFor(request, params.id)
            yield* authorization.bindBrowser({
              actor: access.actor,
              reference: { ...access.reference, id: payload.attemptId, connectionId: params.id },
              challenge: payload.challenge,
            })
          }),
        )
        .handle(
          "completeAuthorization",
          Effect.fn("mcpCompleteAuthorization")(function* ({ request, params, payload }) {
            const access = yield* accessFor(request, params.id)
            yield* authorization.complete({
              actor: access.actor,
              reference: { ...access.reference, id: payload.attemptId, connectionId: params.id },
            })
          }),
        )
    }),
  )
}
