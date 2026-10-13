import { Schema } from "effect"
import { LockVersionSchema, NonEmptyStringSchema } from "../schemas.ts"

const mcpUuidSchema = Schema.String.check(Schema.isUUID())

export const MCP_PROTOCOL_VERSION = "2026-07-28"
export const MCP_MAX_METADATA_BYTES = 1_048_576
export const MCP_MAX_RESULT_BYTES = 5_242_880
export const MCP_MAX_DISCOVERY_PAGES = 64
export const MCP_AUTH_TIMEOUT_MS = 15_000
export const MCP_TOOL_TIMEOUT_MS = 60_000
export const MCP_ATTEMPT_LIFETIME_MS = 600_000
export const MCP_REFRESH_MARGIN_MS = 60_000
export const MCP_REFRESH_LEASE_MS = 30_000

const McpConnectionScopeSchema = Schema.Literals(["organization", "tenant", "tenant_user"])
const McpAuthStateSchema = Schema.Literals([
  "disconnected",
  "connected",
  "reauthorization_required",
  "refresh_uncertain",
])
const McpOwnerSchema = Schema.Struct({
  organizationId: mcpUuidSchema,
  tenantId: Schema.NullOr(mcpUuidSchema),
  tenantUserId: Schema.NullOr(mcpUuidSchema),
}).check(Schema.makeFilter((owner) => owner.tenantUserId === null || owner.tenantId !== null))
export type McpOwner = typeof McpOwnerSchema.Type

export const McpReferenceSchema = Schema.Struct({
  organizationId: mcpUuidSchema,
  tenantId: Schema.NullOr(mcpUuidSchema),
  id: mcpUuidSchema,
})
export type McpReference = typeof McpReferenceSchema.Type

export const McpActorSchema = Schema.Struct({
  ...McpOwnerSchema.fields,
  organizationUserId: Schema.NullOr(mcpUuidSchema),
  admin: Schema.Boolean,
  apiKey: Schema.Boolean,
  interactive: Schema.Boolean,
})
export type McpActor = typeof McpActorSchema.Type

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
    registration: Schema.Literals(["automatic", "pre_registered"]),
    profile: Schema.Literals(["standard", "google"]),
    requestedScopes: Schema.Array(NonEmptyStringSchema.check(Schema.isMaxLength(512))).check(
      Schema.isMaxLength(64),
    ),
  }),
])
export type McpAuthConfig = typeof McpAuthConfigSchema.Type

export const McpOAuthTokensSchema = Schema.Struct({
  access_token: NonEmptyStringSchema,
  token_type: NonEmptyStringSchema,
  refresh_token: Schema.optionalKey(NonEmptyStringSchema),
  expires_in: Schema.optionalKey(Schema.Number),
  scope: Schema.optionalKey(Schema.String),
})

const McpCredentialSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("static_headers"),
    headers: Schema.Record(Schema.String, Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("oauth"),
    issuer: NonEmptyStringSchema,
    resource: NonEmptyStringSchema,
    clientRegistration: McpReferenceSchema,
    tokens: McpOAuthTokensSchema,
    expiresAt: Schema.NullOr(Schema.Number),
    grantedScopes: Schema.Array(Schema.String),
    discovery: Schema.JsonObject,
  }),
])
export type McpCredential = typeof McpCredentialSchema.Type
export const McpCredentialEnvelopeSchema = Schema.Struct({
  version: Schema.Literal(1),
  owner: McpOwnerSchema,
  connection: McpReferenceSchema,
  server: McpReferenceSchema,
  serverAuthRevision: Schema.Int,
  authGeneration: mcpUuidSchema,
  tokenRevision: Schema.Int,
  credential: McpCredentialSchema,
})
export type McpCredentialEnvelope = typeof McpCredentialEnvelopeSchema.Type

export const McpClientEnvelopeSchema = Schema.Struct({
  version: Schema.Literal(1),
  registration: McpReferenceSchema,
  server: McpReferenceSchema,
  serverAuthRevision: Schema.Int,
  issuer: Schema.String,
  resource: Schema.String,
  clientInformation: Schema.JsonObject,
})
export const McpAttemptEnvelopeSchema = Schema.Struct({
  version: Schema.Literal(1),
  attempt: McpReferenceSchema,
  connection: McpReferenceSchema,
  actor: McpActorSchema,
  expectedGeneration: mcpUuidSchema,
  serverAuthRevision: Schema.Int,
  state: Schema.String,
  verifier: Schema.NullOr(Schema.String),
  discovery: Schema.NullOr(Schema.JsonObject),
  clientInformation: Schema.NullOr(Schema.JsonObject),
  registration: Schema.NullOr(McpReferenceSchema),
  authorizationUrl: Schema.NullOr(Schema.String),
  pendingCredential: Schema.NullOr(McpCredentialSchema),
})
export type McpAttemptEnvelope = {
  -readonly [
    Key in keyof typeof McpAttemptEnvelopeSchema.Type
  ]: (typeof McpAttemptEnvelopeSchema.Type)[Key]
}

const McpNameSchema = NonEmptyStringSchema.check(Schema.isMaxLength(128))
const McpServerFieldsSchema = Schema.Struct({
  name: McpNameSchema,
  endpointUrl: Schema.String.check(Schema.isMaxLength(2048)),
  enabled: Schema.Boolean,
  defaultConnectionScope: McpConnectionScopeSchema,
  authConfig: McpAuthConfigSchema,
})
export const McpServerWriteSchema = Schema.Struct({
  ...McpServerFieldsSchema.fields,
  lockVersion: Schema.optionalKey(LockVersionSchema),
})
export const McpConnectionWriteSchema = Schema.Struct({
  name: McpNameSchema,
  serverId: mcpUuidSchema,
  serverTenantId: Schema.NullOr(mcpUuidSchema),
  enabled: Schema.Boolean,
  lockVersion: Schema.optionalKey(LockVersionSchema),
  headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})
export const McpManualClientSchema = Schema.Struct({
  clientId: NonEmptyStringSchema.check(Schema.isMaxLength(2048)),
  clientSecret: Schema.optionalKey(NonEmptyStringSchema.check(Schema.isMaxLength(8192))),
  tokenEndpointAuthMethod: Schema.Literals(["none", "client_secret_basic", "client_secret_post"]),
})
export type McpManualClient = typeof McpManualClientSchema.Type

export const McpPolicySchema = Schema.Struct({
  allowTenantMcpServers: Schema.Boolean,
  allowTenantUserMcpServers: Schema.Boolean,
  lockVersion: LockVersionSchema,
})
export type McpPolicy = typeof McpPolicySchema.Type

export const McpServerSummarySchema = Schema.Struct({
  ...McpReferenceSchema.fields,
  tenantUserId: Schema.NullOr(mcpUuidSchema),
  ...McpServerFieldsSchema.fields,
  authRevision: Schema.Int,
  lockVersion: LockVersionSchema,
})
export type McpServerSummary = typeof McpServerSummarySchema.Type
export const McpConnectionSummarySchema = Schema.Struct({
  ...McpReferenceSchema.fields,
  tenantUserId: Schema.NullOr(mcpUuidSchema),
  serverId: mcpUuidSchema,
  serverTenantId: Schema.NullOr(mcpUuidSchema),
  name: Schema.String,
  enabled: Schema.Boolean,
  authState: McpAuthStateSchema,
  authKind: Schema.optionalKey(Schema.Literals(["none", "static_headers", "oauth"])),
  allowedActions: Schema.optionalKey(
    Schema.Array(Schema.Literals(["update", "delete", "disconnect", "test", "authorize"])),
  ),
  authErrorCode: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.String),
  grantedScopes: Schema.Array(Schema.String),
  lastVerifiedAt: Schema.NullOr(Schema.String),
  verificationResult: Schema.NullOr(Schema.String),
  availability: Schema.optionalKey(
    Schema.Literals(["available", "disabled", "policy_denied", "configuration_changed"]),
  ),
  lockVersion: LockVersionSchema,
})
export type McpConnectionSummary = typeof McpConnectionSummarySchema.Type

export const McpToolPresentationSchema = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  serverId: mcpUuidSchema,
  connectionId: mcpUuidSchema,
  nativeToolName: Schema.String,
})

export function mcpOwnerEquals(left: McpOwner, right: McpOwner): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.tenantId === right.tenantId &&
    left.tenantUserId === right.tenantUserId
  )
}
export function mcpReferenceEquals(left: McpReference, right: McpReference): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.tenantId === right.tenantId &&
    left.id === right.id
  )
}

export function mcpActorEquals(left: McpActor, right: McpActor): boolean {
  return (
    mcpOwnerEquals(left, right) &&
    left.organizationUserId === right.organizationUserId &&
    left.admin === right.admin &&
    left.apiKey === right.apiKey &&
    left.interactive === right.interactive
  )
}

export function mcpReferenceFor(value: McpReference): McpReference {
  return { organizationId: value.organizationId, tenantId: value.tenantId, id: value.id }
}
export function mcpOwnerFor(value: McpOwner): McpOwner {
  return {
    organizationId: value.organizationId,
    tenantId: value.tenantId,
    tenantUserId: value.tenantUserId,
  }
}
