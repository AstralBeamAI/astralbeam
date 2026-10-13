import { Schema } from "effect"
import { LockVersionSchema, NonEmptyStringSchema, UuidV7Schema } from "../schemas.ts"

export const MCP_PROTOCOL_VERSION = "2026-07-28"
export const MCP_MAX_METADATA_BYTES = 1_048_576
export const MCP_MAX_RESULT_BYTES = 5_242_880
export const MCP_MAX_DISCOVERY_PAGES = 64
export const MCP_AUTH_TIMEOUT_MS = 15_000
export const MCP_TOOL_TIMEOUT_MS = 60_000
export const MCP_ATTEMPT_LIFETIME_MS = 600_000
export const MCP_REFRESH_MARGIN_MS = 60_000
export const MCP_REFRESH_LEASE_MS = 30_000

export const McpActorSchema = Schema.Struct({
  organizationId: UuidV7Schema,
  tenantId: UuidV7Schema,
  tenantUserId: UuidV7Schema,
})
export type McpActor = typeof McpActorSchema.Type
export const McpReferenceSchema = Schema.Struct({
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
export const McpManualClientSchema = Schema.Struct({
  clientId: NonEmptyStringSchema.check(Schema.isMaxLength(2048)),
  clientSecret: Schema.optionalKey(NonEmptyStringSchema.check(Schema.isMaxLength(8192))),
  tokenEndpointAuthMethod: Schema.Literals(["none", "client_secret_basic", "client_secret_post"]),
})
export const McpAuthConfigSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("static_headers"),
    headerNames: Schema.Array(NonEmptyStringSchema.check(Schema.isMaxLength(128))).check(
      Schema.isMaxLength(16),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("oauth"),
    profile: Schema.Literals(["standard", "google"]),
    requestedScopes: Schema.Array(NonEmptyStringSchema.check(Schema.isMaxLength(512))).check(
      Schema.isMaxLength(64),
    ),
    client: Schema.optionalKey(McpManualClientSchema),
  }),
])
export type McpAuthConfig = typeof McpAuthConfigSchema.Type
export const McpServerWriteSchema = Schema.Struct({
  endpointUrl: Schema.String.check(Schema.isMaxLength(2048)),
  authConfig: McpAuthConfigSchema,
})
export const McpServerEnvelopeSchema = Schema.Struct({
  organizationId: UuidV7Schema,
  id: UuidV7Schema,
  authConfig: McpAuthConfigSchema,
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
const McpCredentialSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("static_headers"),
    headers: Schema.Record(Schema.String, Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("oauth"),
    clientInformation: Schema.JsonObject,
    tokens: McpOAuthTokensSchema,
    expiresAt: Schema.NullOr(Schema.Number),
    discovery: Schema.JsonObject,
  }),
])
export type McpCredential = typeof McpCredentialSchema.Type
export const McpCredentialEnvelopeSchema = Schema.Struct({
  version: Schema.Literal(1),
  ...McpActorSchema.fields,
  id: UuidV7Schema,
  serverId: UuidV7Schema,
  lockVersion: LockVersionSchema,
  credential: McpCredentialSchema,
})
export type McpCredentialEnvelope = typeof McpCredentialEnvelopeSchema.Type
export const McpAttemptEnvelopeSchema = Schema.Struct({
  attempt: McpAttemptReferenceSchema,
  actor: McpActorSchema,
  expectedVersion: LockVersionSchema,
  expiresAt: Schema.Number,
  status: Schema.Literals(["authorizing", "exchanging", "awaiting_completion"]),
  browserBindingHash: Schema.NullOr(Schema.String),
  state: Schema.String,
  verifier: Schema.NullOr(Schema.String),
  discovery: Schema.NullOr(Schema.JsonObject),
  clientInformation: Schema.NullOr(Schema.JsonObject),
  authorizationUrl: Schema.NullOr(Schema.String),
  pendingCredential: Schema.NullOr(McpCredentialSchema),
})
export type McpAttemptEnvelope = {
  -readonly [
    K in keyof typeof McpAttemptEnvelopeSchema.Type
  ]: (typeof McpAttemptEnvelopeSchema.Type)[K]
}
export const McpConnectionWriteSchema = Schema.Struct({ serverId: UuidV7Schema })
export const McpHeadersWriteSchema = Schema.Struct({
  lockVersion: LockVersionSchema,
  headers: Schema.Record(Schema.String, Schema.String),
})
export const McpConnectionSummarySchema = Schema.Struct({
  ...McpReferenceSchema.fields,
  serverId: UuidV7Schema,
  lockVersion: LockVersionSchema,
  authState: Schema.Literals(["disconnected", "connected", "reauthorization_required"]),
})
export type McpConnectionSummary = typeof McpConnectionSummarySchema.Type
export const McpToolPresentationSchema = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  serverId: UuidV7Schema,
  connectionId: UuidV7Schema,
  nativeToolName: Schema.String,
})
export function mcpActorEquals(left: McpActor, right: McpActor): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.tenantId === right.tenantId &&
    left.tenantUserId === right.tenantUserId
  )
}
