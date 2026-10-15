import { Effect, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import type { ApiV1 } from "./contract.server"
import { ApiUuidSchema } from "@/lib/tenants/schemas.ts"
import {
  McpAttemptReferenceSchema,
  McpConnectionSummarySchema,
  McpConnectionWriteSchema,
  McpHeadersWriteSchema,
  McpServerSummarySchema,
} from "@/lib/mcp/schemas.ts"

const mcpWireKeys = {
  organizationId: "organization_id",
  tenantId: "tenant_id",
  mcpServerId: "mcp_server_id",
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
const mcpConnectionParams = Schema.Struct({ id: ApiUuidSchema })
const mcpAttemptBody = Schema.Struct({ attemptId: ApiUuidSchema }).pipe(
  Schema.encodeKeys({ attemptId: "attempt_id" }),
)
export const personalMcpApi = HttpApiGroup.make("personalMcp")
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
    HttpApiEndpoint.post("setHeaders", "/me/mcp/connections/:id/headers", {
      params: mcpConnectionParams,
      payload: McpHeadersWriteSchema.pipe(Schema.encodeKeys(mcpWireKeys)),
    }),
    HttpApiEndpoint.delete("disconnectConnection", "/me/mcp/connections/:id", {
      params: mcpConnectionParams,
    }),
    HttpApiEndpoint.post("testConnection", "/me/mcp/connections/:id/test", {
      params: mcpConnectionParams,
      success: Schema.Struct({ toolCount: Schema.Int }).pipe(
        Schema.encodeKeys({ toolCount: "tool_count" }),
      ),
    }),
    HttpApiEndpoint.post("authorizeConnection", "/me/mcp/connections/:id/authorize", {
      params: mcpConnectionParams,
      success: Schema.Struct({
        attempt: McpAttemptReferenceSchema.pipe(Schema.encodeKeys(mcpWireKeys)),
        popupUrl: Schema.String,
      }).pipe(Schema.encodeKeys({ popupUrl: "popup_url" })),
    }),
    HttpApiEndpoint.post("bindBrowser", "/me/mcp/connections/:id/oauth/bind", {
      params: mcpConnectionParams,
      payload: Schema.Struct({ attemptId: ApiUuidSchema, challenge: Schema.String }).pipe(
        Schema.encodeKeys({ attemptId: "attempt_id" }),
      ),
    }),
    HttpApiEndpoint.post("completeAuthorization", "/me/mcp/connections/:id/oauth/complete", {
      params: mcpConnectionParams,
      payload: mcpAttemptBody,
      success: Schema.Boolean,
    }),
  )
  .annotateEndpoints(OpenApi.Override, { security: [{ astralBeamToken: [] }] })
export function personalMcpHandlers(api: typeof ApiV1) {
  return HttpApiBuilder.group(
    api,
    "personalMcp",
    Effect.fn("personalMcpHandlers")(function* (handlers) {
      const { McpConnections } = yield* Effect.promise(() => import("@/lib/mcp/mcp.server"))
      const { McpAuthorization } = yield* Effect.promise(
        () => import("@/lib/mcp/authorization.server"),
      )
      const { McpTools } = yield* Effect.promise(() => import("@/lib/mcp/tools.server"))
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
        .handle("getCatalog", ({ request }) =>
          Effect.flatMap(actorFor(request), connections.catalog),
        )
        .handle("createConnection", ({ request, payload }) =>
          Effect.flatMap(actorFor(request), (actor) =>
            connections.createConnection(actor, payload.mcpServerId),
          ),
        )
        .handle("setHeaders", ({ request, params, payload }) =>
          Effect.flatMap(accessFor(request, params.id), (access) =>
            connections.setHeaders({ ...access, ...payload }),
          ),
        )
        .handle("disconnectConnection", ({ request, params }) =>
          Effect.flatMap(accessFor(request, params.id), authorization.disconnect),
        )
        .handle("testConnection", ({ request, params }) =>
          Effect.flatMap(accessFor(request, params.id), tools.test),
        )
        .handle("authorizeConnection", ({ request, params }) =>
          Effect.flatMap(accessFor(request, params.id), (access) =>
            authorization.start({
              ...access,
              origin: request.headers.origin ?? "",
            }),
          ),
        )
        .handle("bindBrowser", ({ request, params, payload }) =>
          Effect.flatMap(accessFor(request, params.id), ({ actor, reference }) =>
            authorization.bindBrowser({
              actor,
              reference: { ...reference, id: payload.attemptId, connectionId: params.id },
              challenge: payload.challenge,
            }),
          ),
        )
        .handle("completeAuthorization", ({ request, params, payload }) =>
          Effect.flatMap(accessFor(request, params.id), ({ actor, reference }) =>
            authorization.complete({
              actor,
              reference: { ...reference, id: payload.attemptId, connectionId: params.id },
            }),
          ),
        )
    }),
  )
}
