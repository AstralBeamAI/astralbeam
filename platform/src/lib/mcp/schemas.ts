import { Schema } from "effect"
import { LockVersionSchema, NonEmptyStringSchema, UuidV7Schema } from "../schemas.ts"

export const MCP_PROTOCOL_VERSION = "2026-07-28"
export const MCP_MAX_METADATA_BYTES = 1_048_576
export const MCP_MAX_RESULT_BYTES = 5_242_880
export const MCP_MAX_DISCOVERY_PAGES = 8
export const MCP_MAX_CONNECTIONS = 16
export const MCP_AUTH_TIMEOUT_MS = 15_000
export const MCP_TOOL_TIMEOUT_MS = 60_000
export const MCP_ATTEMPT_LIFETIME_MS = 600_000
export const MCP_REFRESH_MARGIN_MS = 60_000
export const MCP_REFRESH_LEASE_MS = 30_000

const McpActorSchema = Schema.Struct({
  organizationId: UuidV7Schema,
  tenantId: UuidV7Schema,
  tenantUserId: UuidV7Schema,
})
export type McpActor = typeof McpActorSchema.Type
const McpReferenceSchema = Schema.Struct({
  organizationId: UuidV7Schema,
  tenantId: UuidV7Schema,
  id: UuidV7Schema,
})
export type McpReference = typeof McpReferenceSchema.Type
export const McpAttemptReferenceSchema = Schema.Struct({
  ...McpReferenceSchema.fields,
  connectionId: UuidV7Schema,
  id: Schema.String.check(Schema.isUUID()),
})
export type McpAttemptReference = typeof McpAttemptReferenceSchema.Type
export function mcpHeadersAreAllowed(headers: Readonly<Record<string, string>>): boolean {
  if (
    new Set(Object.keys(headers).map((name) => name.toLowerCase())).size !==
    Object.keys(headers).length
  )
    return false
  return Object.entries(headers).every(
    ([name, value]) =>
      /^[!#$%&'*+.^`|~\w-]+$/.test(name) &&
      !/[\r\n\0]/.test(value) &&
      !/^(?:host|cookie|set-cookie|origin|referer|connection|content-length|content-type|accept|transfer-encoding|upgrade|expect|te|trailer|via|forwarded|proxy-.*|sec-.*|x-forwarded-.*|mcp-.*|x-mcp-.*)$/i.test(
        name,
      ),
  )
}

const McpManualClientSchema = Schema.Struct({
  clientId: NonEmptyStringSchema.check(Schema.isMaxLength(2048)),
  clientSecret: Schema.optionalKey(NonEmptyStringSchema.check(Schema.isMaxLength(8192))),
})
export const McpApplicationOriginSchema = Schema.String.check(
  Schema.isMaxLength(2048),
  Schema.makeFilter(
    (value) => {
      if (!URL.canParse(value)) return false
      const url = new URL(value)
      return (
        value === url.origin &&
        (url.protocol === "https:" ||
          (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
      )
    },
    { message: "Enter an HTTPS origin without a path. Localhost HTTP is allowed for development" },
  ),
)
const mcpAuthConfigSchema = <S extends Schema.Constraint>(clientSchema: S) =>
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("none") }),
    Schema.Struct({
      kind: Schema.Literal("static_headers"),
      headerNames: Schema.Array(NonEmptyStringSchema.check(Schema.isMaxLength(128))).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(16),
        Schema.makeFilter(
          (names) =>
            new Set(names).size === names.length &&
            mcpHeadersAreAllowed(Object.fromEntries(names.map((name) => [name, ""]))),
          {
            message: "Use unique HTTP header names. Cookies, routing and MCP headers are reserved",
          },
        ),
      ),
    }),
    Schema.Struct({
      kind: Schema.Literal("oauth"),
      profile: Schema.Literals(["standard", "google"]),
      applicationOrigin: Schema.optionalKey(McpApplicationOriginSchema),
      requestedScopes: Schema.Array(NonEmptyStringSchema.check(Schema.isMaxLength(512))).check(
        Schema.isMaxLength(64),
      ),
      client: Schema.optionalKey(clientSchema),
    }),
  ])
const McpAuthConfigSchema = mcpAuthConfigSchema(McpManualClientSchema).check(
  Schema.makeFilter((config) =>
    config.kind !== "oauth" || config.profile !== "google" || config.client?.clientSecret
      ? true
      : { path: ["client", "clientSecret"], issue: "Enter the Google application client secret" },
  ),
)
export type McpAuthConfig = typeof McpAuthConfigSchema.Type
export const McpServerWriteSchema = Schema.Struct({
  endpointUrl: Schema.String.check(Schema.isMaxLength(2048)),
  authConfig: McpAuthConfigSchema,
})
export const McpStoredAuthConfigSchema = mcpAuthConfigSchema(Schema.String)
export const McpClientEnvelopeSchema = Schema.Struct({
  organizationId: UuidV7Schema,
  id: UuidV7Schema,
  client: McpManualClientSchema,
})
export const McpServerSummarySchema = Schema.Struct({
  organizationId: UuidV7Schema,
  id: UuidV7Schema,
  endpointUrl: Schema.String,
  authKind: Schema.NullOr(Schema.Literals(["none", "static_headers", "oauth"])),
  headerNames: Schema.Array(Schema.String),
})
export type McpServerSummary = typeof McpServerSummarySchema.Type
export const McpOAuthTokensSchema = Schema.Struct({
  access_token: NonEmptyStringSchema,
  token_type: NonEmptyStringSchema,
  refresh_token: Schema.optionalKey(NonEmptyStringSchema),
  expires_in: Schema.optionalKey(Schema.Number),
  scope: Schema.optionalKey(Schema.String),
})
const McpStaticHeadersSchema = Schema.Record(
  Schema.String,
  Schema.String.check(Schema.isMaxLength(8192)),
).check(
  Schema.makeFilter(
    (headers) => new TextEncoder().encode(JSON.stringify(headers)).byteLength <= 16_384,
  ),
)
// Keep provider extension metadata while validating the fields required by the SDK's discovery state.
// https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/src/client/auth.ts
export const McpDiscoverySchema = Schema.Struct({
  authorizationServerUrl: Schema.String,
  authorizationServerMetadata: Schema.optionalKey(
    Schema.StructWithRest(
      Schema.Struct({
        issuer: Schema.String,
        authorization_endpoint: Schema.String,
        token_endpoint: Schema.String,
        response_types_supported: Schema.mutable(Schema.Array(Schema.String)),
      }),
      [Schema.JsonObject],
    ),
  ),
  resourceMetadata: Schema.optionalKey(
    Schema.StructWithRest(Schema.Struct({ resource: Schema.String }), [Schema.JsonObject]),
  ),
  resourceMetadataUrl: Schema.optionalKey(Schema.String),
})

const McpCredentialSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("static_headers"),
    headers: McpStaticHeadersSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("oauth"),
    clientInformation: Schema.JsonObject,
    tokens: McpOAuthTokensSchema,
    expiresAt: Schema.NullOr(Schema.Number),
    discovery: McpDiscoverySchema,
  }),
])
export type McpCredential = typeof McpCredentialSchema.Type
export const McpCredentialEnvelopeSchema = Schema.Struct({
  version: Schema.Literal(1),
  ...McpActorSchema.fields,
  id: UuidV7Schema,
  mcpServerId: UuidV7Schema,
  lockVersion: LockVersionSchema,
  refreshStartedAt: Schema.optionalKey(Schema.Number),
  credential: McpCredentialSchema,
})
export type McpCredentialEnvelope = typeof McpCredentialEnvelopeSchema.Type
export const McpAttemptEnvelopeSchema = Schema.Struct({
  attempt: McpAttemptReferenceSchema,
  actor: McpActorSchema,
  expectedVersion: LockVersionSchema,
  origin: Schema.String,
  expiresAt: Schema.Number,
  status: Schema.Literals(["authorizing", "exchanging", "awaiting_completion", "failed"]),
  browserBindingHash: Schema.NullOr(Schema.String),
  state: Schema.String,
  verifier: Schema.NullOr(Schema.String),
  discovery: Schema.NullOr(McpDiscoverySchema),
  clientInformation: Schema.NullOr(Schema.JsonObject),
  authorizationUrl: Schema.NullOr(Schema.String),
  pendingCredential: Schema.NullOr(McpCredentialSchema),
})
export type McpAttemptEnvelope = {
  -readonly [
    K in keyof typeof McpAttemptEnvelopeSchema.Type
  ]: (typeof McpAttemptEnvelopeSchema.Type)[K]
}
export const McpConnectionWriteSchema = Schema.Struct({ mcpServerId: UuidV7Schema })
export const McpHeadersWriteSchema = Schema.Struct({
  lockVersion: LockVersionSchema,
  headers: McpStaticHeadersSchema,
})
export const McpConnectionSummarySchema = Schema.Struct({
  ...McpReferenceSchema.fields,
  mcpServerId: UuidV7Schema,
  lockVersion: LockVersionSchema,
  authState: Schema.Literals(["disconnected", "connected", "reauthorization_required"]),
})
export type McpConnectionSummary = typeof McpConnectionSummarySchema.Type
export function mcpActorEquals(left: McpActor, right: McpActor): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.tenantId === right.tenantId &&
    left.tenantUserId === right.tenantUserId
  )
}

export class McpForbidden extends Schema.TaggedError<McpForbidden>()(
  "McpForbidden",
  {},
  { httpApiStatus: 403 },
) {
  override readonly message = "You cannot use or manage this MCP connection."
}
export class McpNotFound extends Schema.TaggedError<McpNotFound>()(
  "McpNotFound",
  {},
  { httpApiStatus: 404 },
) {
  override readonly message = "The MCP server or connection was not found."
}
export class McpServerExists extends Schema.TaggedError<McpServerExists>()(
  "McpServerExists",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "An MCP server with this URL already exists."
}
export class McpChanged extends Schema.TaggedError<McpChanged>()(
  "McpChanged",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "The MCP configuration changed. Refresh and try again."
}
export class McpInvalidConfiguration extends Schema.TaggedError<McpInvalidConfiguration>()(
  "McpInvalidConfiguration",
  {},
  { httpApiStatus: 400 },
) {
  override readonly message = "Use a public HTTPS endpoint and supported authentication settings."
}
export class McpAuthorizationRequired extends Schema.TaggedError<McpAuthorizationRequired>()(
  "McpAuthorizationRequired",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "Reconnect to continue using this MCP server."
}
export class McpAuthorizationFailed extends Schema.TaggedError<McpAuthorizationFailed>()(
  "McpAuthorizationFailed",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "Authorization was not completed. Try connecting again."
}
export class McpUnavailable extends Schema.TaggedError<McpUnavailable>()(
  "McpUnavailable",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message = "The MCP server is unavailable. Check the connection and try again."
}

export class McpUnsupportedProtocol extends Schema.TaggedError<McpUnsupportedProtocol>()(
  "McpUnsupportedProtocol",
  {},
  { httpApiStatus: 400 },
) {
  override readonly message = `Could not connect using MCP ${MCP_PROTOCOL_VERSION}. Check the server URL and confirm it supports this version over Streamable HTTP.`
}
