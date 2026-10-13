import { Effect, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import {
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api"
import { restPaginationQuery, restPageFields, restPageHeaders } from "./shared.server"
import type { ApiV1 } from "./contract.server"
import { ApiUuidSchema } from "../../../../lib/tenants/schemas.ts"
import {
  McpAuthConfigSchema,
  McpConnectionSummarySchema,
  McpConnectionWriteSchema,
  McpManualClientSchema,
  McpPolicySchema,
  McpReferenceSchema,
  McpServerSummarySchema,
  McpServerWriteSchema,
} from "../../../../lib/mcp/schemas.ts"

const mcpRestKeys = {
  organizationId: "organization_id",
  tenantId: "tenant_id",
  tenantUserId: "tenant_user_id",
  endpointUrl: "endpoint_url",
  defaultConnectionScope: "default_connection_scope",
  authConfig: "auth_config",
  authRevision: "auth_revision",
  lockVersion: "lock_version",
  serverId: "server_id",
  serverTenantId: "server_tenant_id",
  authState: "auth_state",
  authKind: "auth_kind",
  allowedActions: "allowed_actions",
  authErrorCode: "auth_error_code",
  expiresAt: "expires_at",
  grantedScopes: "granted_scopes",
  lastVerifiedAt: "last_verified_at",
  verificationResult: "verification_result",
} as const
const mcpWireAuthConfig = Schema.Union([
  McpAuthConfigSchema.members[0],
  McpAuthConfigSchema.members[1].pipe(Schema.encodeKeys({ headerNames: "header_names" })),
  McpAuthConfigSchema.members[2].pipe(Schema.encodeKeys({ requestedScopes: "requested_scopes" })),
])
const McpRestServer = Schema.Struct({
  ...McpServerSummarySchema.fields,
  authConfig: mcpWireAuthConfig,
})
  .pipe(Schema.encodeKeys(mcpRestKeys))
  .annotate({ identifier: "McpServer" })
const McpRestServerWrite = Schema.Struct({
  ...McpServerWriteSchema.fields,
  authConfig: mcpWireAuthConfig,
})
  .pipe(Schema.encodeKeys(mcpRestKeys))
  .annotate({ identifier: "McpServerInput" })
const McpRestConnection = McpConnectionSummarySchema.pipe(Schema.encodeKeys(mcpRestKeys)).annotate({
  identifier: "McpConnection",
})
const McpRestConnectionWrite = McpConnectionWriteSchema.pipe(
  Schema.encodeKeys(mcpRestKeys),
).annotate({ identifier: "McpConnectionInput" })
const McpRestManualClient = McpManualClientSchema.pipe(
  Schema.encodeKeys({
    clientId: "client_id",
    clientSecret: "client_secret",
    tokenEndpointAuthMethod: "token_endpoint_auth_method",
  }),
)
const McpRestPolicy = McpPolicySchema.pipe(
  Schema.encodeKeys({
    allowTenantMcpServers: "allow_tenant_mcp_servers",
    allowTenantUserMcpServers: "allow_tenant_user_mcp_servers",
    lockVersion: "lock_version",
  }),
).annotate({ identifier: "McpPolicy" })
const mcpVersionQuery = Schema.Struct({ lock_version: Schema.Int })
const mcpRestSecurity = {
  security: [{ OrganizationApiKey: [] }, { astralBeamToken: [] }, { organizationToken: [] }],
}

function mcpResourceApi<const Name extends string>(name: Name, prefix: `/${string}`) {
  const mcpCollectionParams = prefix.includes(":tenant_id")
    ? Schema.Struct({ tenant_id: ApiUuidSchema })
    : Schema.Struct({})
  const mcpMemberParams = prefix.includes(":tenant_id")
    ? Schema.Struct({ tenant_id: ApiUuidSchema, id: ApiUuidSchema })
    : Schema.Struct({ id: ApiUuidSchema })
  return HttpApiGroup.make(name)
    .annotateEndpoints(OpenApi.Override, mcpRestSecurity)
    .add(
      HttpApiEndpoint.get("listServers", `${prefix}/servers`, {
        params: mcpCollectionParams,
        query: restPaginationQuery,
        success: HttpApiSchema.WithHeaders(
          Schema.Struct({ items: Schema.Array(McpRestServer), ...restPageFields }),
          restPageHeaders,
        ),
      }),
      HttpApiEndpoint.post("createServer", `${prefix}/servers`, {
        params: mcpCollectionParams,
        payload: McpRestServerWrite,
        success: McpRestServer,
      }),
      HttpApiEndpoint.get("getServer", `${prefix}/servers/:id`, {
        params: mcpMemberParams,
        success: McpRestServer,
      }),
      HttpApiEndpoint.patch("updateServer", `${prefix}/servers/:id`, {
        params: mcpMemberParams,
        payload: McpRestServerWrite,
        success: McpRestServer,
      }),
      HttpApiEndpoint.delete("deleteServer", `${prefix}/servers/:id`, {
        params: mcpMemberParams,
        query: mcpVersionQuery,
      }),
      HttpApiEndpoint.post("configureClient", `${prefix}/servers/:id/oauth-client`, {
        params: mcpMemberParams,
        payload: McpRestManualClient,
      }),
      HttpApiEndpoint.get("listConnections", `${prefix}/connections`, {
        params: mcpCollectionParams,
        query: restPaginationQuery,
        success: HttpApiSchema.WithHeaders(
          Schema.Struct({ items: Schema.Array(McpRestConnection), ...restPageFields }),
          restPageHeaders,
        ),
      }),
      HttpApiEndpoint.post("createConnection", `${prefix}/connections`, {
        params: mcpCollectionParams,
        payload: McpRestConnectionWrite,
        success: McpRestConnection,
      }),
      HttpApiEndpoint.get("getConnection", `${prefix}/connections/:id`, {
        params: mcpMemberParams,
        success: McpRestConnection,
      }),
      HttpApiEndpoint.patch("updateConnection", `${prefix}/connections/:id`, {
        params: mcpMemberParams,
        payload: McpRestConnectionWrite,
        success: McpRestConnection,
      }),
      HttpApiEndpoint.delete("deleteConnection", `${prefix}/connections/:id`, {
        params: mcpMemberParams,
        query: mcpVersionQuery,
      }),
      HttpApiEndpoint.post("disconnectConnection", `${prefix}/connections/:id/disconnect`, {
        params: mcpMemberParams,
      }),
      HttpApiEndpoint.post("testConnection", `${prefix}/connections/:id/test`, {
        params: mcpMemberParams,
        success: Schema.Struct({ toolCount: Schema.Int }).pipe(
          Schema.encodeKeys({ toolCount: "tool_count" }),
        ),
      }),
      HttpApiEndpoint.post("authorizeConnection", `${prefix}/connections/:id/authorize`, {
        params: mcpMemberParams,
        payload: Schema.Struct({ manualClient: Schema.optionalKey(McpRestManualClient) }).pipe(
          Schema.encodeKeys({ manualClient: "manual_client" }),
        ),
        success: Schema.Struct({
          attempt: McpReferenceSchema.pipe(Schema.encodeKeys(mcpRestKeys)),
          popupUrl: Schema.String,
        }).pipe(Schema.encodeKeys({ popupUrl: "popup_url" })),
      }),
    )
}
export const organizationMcpApi = mcpResourceApi("organizationMcp", "/mcp")
export const tenantMcpApi = mcpResourceApi("tenantMcp", "/tenants/:tenant_id/mcp")
export const personalMcpApi = mcpResourceApi("personalMcp", "/me/mcp")
export const mcpAuthorizationApi = HttpApiGroup.make("mcpAuthorization")
  .annotateEndpoints(OpenApi.Override, mcpRestSecurity)
  .add(
    HttpApiEndpoint.get("getPolicy", "/mcp/policy", { success: McpRestPolicy }),
    HttpApiEndpoint.patch("updatePolicy", "/mcp/policy", {
      payload: McpRestPolicy,
      success: McpRestPolicy,
    }),
    HttpApiEndpoint.get("getCatalog", "/me/mcp/catalog", {
      success: Schema.Struct({
        servers: Schema.Array(McpRestServer),
        connections: Schema.Array(McpRestConnection),
        policy: McpRestPolicy,
        callback_uri: Schema.NullOr(Schema.String),
      }),
    }),
    HttpApiEndpoint.get("authorizationStatus", "/mcp/authorization-attempts/:id", {
      params: { id: ApiUuidSchema },
      query: Schema.Struct({ tenant_id: Schema.optionalKey(ApiUuidSchema) }),
      success: Schema.Struct({ status: Schema.String }),
    }),
    HttpApiEndpoint.post("bindBrowser", "/mcp/authorization-attempts/:id/bind", {
      params: { id: ApiUuidSchema },
      payload: Schema.Struct({
        tenant_id: Schema.optionalKey(ApiUuidSchema),
        challenge: Schema.String.check(Schema.isMaxLength(128)),
      }),
    }),
    HttpApiEndpoint.post("completeAuthorization", "/mcp/authorization-attempts/:id/complete", {
      params: { id: ApiUuidSchema },
      payload: Schema.Struct({ tenant_id: Schema.optionalKey(ApiUuidSchema) }),
    }),
  )

export function mcpResourceHandlers(
  api: typeof ApiV1,
  name: "organizationMcp" | "tenantMcp" | "personalMcp",
  kind: "organization" | "tenant" | "personal",
) {
  return HttpApiBuilder.group(
    api,
    name,
    Effect.fn("mcpResourceHandlers")(function* (handlers) {
      const { restPage, restPageOptions } = yield* Effect.promise(
        () => import("./pagination.server"),
      )
      const { McpConnections } = yield* Effect.promise(() => import("@/lib/mcp/mcp.server"))
      const { McpAuthorization } = yield* Effect.promise(
        () => import("@/lib/mcp/authorization/authorization"),
      )
      const { McpTools } = yield* Effect.promise(() => import("@/lib/mcp/tools/tools"))
      const { mcpConnectionSummary } = yield* Effect.promise(() => import("@/lib/mcp/store.server"))
      const { authenticateMcpRequest, mcpRequestOwner } = yield* Effect.promise(
        () => import("./mcp-auth.server"),
      )
      const { McpForbidden } = yield* Effect.promise(() => import("@/lib/mcp/errors"))
      const connections = yield* McpConnections
      const authorization = yield* McpAuthorization
      const tools = yield* McpTools
      const context =
        yield* Effect.context<Effect.Services<ReturnType<typeof authenticateMcpRequest>>>()
      const scopeFor = Effect.fnUntraced(function* (
        request: HttpServerRequest.HttpServerRequest,
        params: { readonly id?: string; readonly tenant_id?: string },
      ) {
        const actor = yield* authenticateMcpRequest(
          yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie),
        ).pipe(Effect.provideContext(context))
        const owner = mcpRequestOwner(actor, kind, params.tenant_id)
        if (!owner) return yield* new McpForbidden()
        return { actor, owner }
      })
      const accessFor = Effect.fnUntraced(function* (
        request: HttpServerRequest.HttpServerRequest,
        params: { readonly id: string; readonly tenant_id?: string },
      ) {
        const { actor, owner } = yield* scopeFor(request, params)
        return { actor, reference: { ...owner, id: params.id } }
      })
      type McpSaveRequest<A> = {
        request: HttpServerRequest.HttpServerRequest
        params: { readonly id?: string; readonly tenant_id?: string }
        payload: A
      }
      const saveServer = Effect.fn("mcpSaveServer")(function* ({
        request,
        params,
        payload,
      }: McpSaveRequest<typeof McpRestServerWrite.Type>) {
        return yield* connections.saveServer({
          ...(yield* scopeFor(request, params)),
          id: params.id,
          fields: payload,
        })
      })
      const saveConnection = Effect.fn("mcpSaveConnection")(function* ({
        request,
        params,
        payload,
      }: McpSaveRequest<typeof McpRestConnectionWrite.Type>) {
        return yield* connections.saveConnection({
          ...(yield* scopeFor(request, params)),
          id: params.id,
          fields: payload,
        })
      })
      return handlers
        .handle(
          "listServers",
          Effect.fn("mcpListServers")(function* ({ request, params, query }) {
            const scope = yield* scopeFor(request, params)
            const page = yield* restPageOptions(query, "mcp_servers", scope.owner)
            return yield* restPage(yield* connections.pageServers({ ...scope, page }), {
              ...page,
              collection: "mcp_servers",
              scope: scope.owner,
              url: request.url,
            })
          }),
        )
        .handle("createServer", saveServer)
        .handle(
          "getServer",
          Effect.fn("mcpGetServer")(function* ({ request, params }) {
            return yield* connections.getServer(yield* accessFor(request, params))
          }),
        )
        .handle("updateServer", saveServer)
        .handle(
          "deleteServer",
          Effect.fn("mcpDeleteServer")(function* ({ request, params, query }) {
            yield* connections.remove({
              ...(yield* accessFor(request, params)),
              kind: "server",
              lockVersion: query.lock_version,
            })
          }),
        )
        .handle(
          "configureClient",
          Effect.fn("mcpConfigureClient")(function* ({ request, params, payload }) {
            yield* authorization.configureClient({
              ...(yield* accessFor(request, params)),
              manualClient: payload,
            })
          }),
        )
        .handle(
          "listConnections",
          Effect.fn("mcpListConnections")(function* ({ request, params, query }) {
            const scope = yield* scopeFor(request, params)
            const page = yield* restPageOptions(query, "mcp_connections", scope.owner)
            return yield* restPage(yield* connections.pageConnections({ ...scope, page }), {
              ...page,
              collection: "mcp_connections",
              scope: scope.owner,
              url: request.url,
            })
          }),
        )
        .handle("createConnection", saveConnection)
        .handle(
          "getConnection",
          Effect.fn("mcpGetConnection")(function* ({ request, params }) {
            const access = yield* accessFor(request, params)
            const { connection, server } = yield* connections.getConnection(access)
            return mcpConnectionSummary(connection, server, true, access.actor.interactive)
          }),
        )
        .handle("updateConnection", saveConnection)
        .handle(
          "deleteConnection",
          Effect.fn("mcpDeleteConnection")(function* ({ request, params, query }) {
            yield* connections.remove({
              ...(yield* accessFor(request, params)),
              kind: "connection",
              lockVersion: query.lock_version,
            })
          }),
        )
        .handle(
          "disconnectConnection",
          Effect.fn("mcpDisconnectConnection")(function* ({ request, params }) {
            yield* connections.disconnect(yield* accessFor(request, params))
          }),
        )
        .handle(
          "testConnection",
          Effect.fn("mcpTestConnection")(function* ({ request, params }) {
            return yield* tools.test(yield* accessFor(request, params))
          }),
        )
        .handle(
          "authorizeConnection",
          Effect.fn("mcpAuthorizeConnection")(function* ({ request, params, payload }) {
            return yield* authorization.start({
              ...(yield* accessFor(request, params)),
              manualClient: payload.manualClient,
            })
          }),
        )
    }),
  )
}

export function mcpAuthorizationHandlers(api: typeof ApiV1) {
  return HttpApiBuilder.group(
    api,
    "mcpAuthorization",
    Effect.fn("mcpAuthorizationHandlers")(function* (handlers) {
      const { McpConnections } = yield* Effect.promise(() => import("@/lib/mcp/mcp.server"))
      const { McpAuthorization } = yield* Effect.promise(
        () => import("@/lib/mcp/authorization/authorization"),
      )
      const { Config } = yield* Effect.promise(() => import("@/lib/config/config"))
      const { authenticateMcpRequest } = yield* Effect.promise(() => import("./mcp-auth.server"))
      const { McpForbidden } = yield* Effect.promise(() => import("@/lib/mcp/errors"))
      const connections = yield* McpConnections
      const authorization = yield* McpAuthorization
      const config = yield* Config
      const context =
        yield* Effect.context<Effect.Services<ReturnType<typeof authenticateMcpRequest>>>()
      const actorFor = (request: HttpServerRequest.HttpServerRequest) =>
        HttpServerRequest.toWeb(request).pipe(
          Effect.orDie,
          Effect.flatMap(authenticateMcpRequest),
          Effect.provideContext(context),
        )
      return handlers
        .handle(
          "getPolicy",
          Effect.fn("mcpGetPolicy")(function* ({ request }) {
            const actor = yield* actorFor(request)
            if (actor.tenantId !== null) return yield* new McpForbidden()
            return yield* connections.policy(actor.organizationId)
          }),
        )
        .handle(
          "updatePolicy",
          Effect.fn("mcpUpdatePolicy")(function* ({ request, payload }) {
            return yield* connections.savePolicy({
              actor: yield* actorFor(request),
              policy: payload,
            })
          }),
        )
        .handle(
          "getCatalog",
          Effect.fn("mcpGetCatalog")(function* ({ request }) {
            const actor = yield* actorFor(request)
            if (actor.tenantId === null) return yield* new McpForbidden()
            const catalog = yield* connections.catalog(actor)
            const baseUrl = yield* config.get("app_base_url")
            return {
              ...catalog,
              callback_uri: baseUrl ? new URL("/api/mcp/oauth/callback", baseUrl).href : null,
            }
          }),
        )
        .handle(
          "authorizationStatus",
          Effect.fn("mcpAuthorizationStatus")(function* ({ request, params, query }) {
            const actor = yield* actorFor(request)
            return yield* authorization.status({
              actor,
              reference: {
                organizationId: actor.organizationId,
                tenantId: query.tenant_id ?? null,
                id: params.id,
              },
            })
          }),
        )
        .handle(
          "bindBrowser",
          Effect.fn("mcpBindBrowser")(function* ({ request, params, payload }) {
            const actor = yield* actorFor(request)
            yield* authorization.bindBrowser({
              actor,
              reference: {
                organizationId: actor.organizationId,
                tenantId: payload.tenant_id ?? null,
                id: params.id,
              },
              challenge: payload.challenge,
            })
          }),
        )
        .handle(
          "completeAuthorization",
          Effect.fn("mcpCompleteAuthorization")(function* ({ request, params, payload }) {
            const actor = yield* actorFor(request)
            yield* authorization.complete({
              actor,
              reference: {
                organizationId: actor.organizationId,
                tenantId: payload.tenant_id ?? null,
                id: params.id,
              },
            })
          }),
        )
    }),
  )
}
