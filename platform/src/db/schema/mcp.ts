import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  primaryKey,
  snakeCase,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { Schema } from "effect"
import {
  caseInsensitiveText,
  deferrableForeignKey,
  encryptedJson,
  lockVersion,
  schemaJsonb,
  timestamps,
  timestampWithTimeZone,
  uuidV7,
} from "../lib/columns.ts"
import { organization, tenant, tenantUser } from "./organizations.ts"
import {
  McpActorSchema,
  McpAttemptEnvelopeSchema,
  McpAuthConfigSchema,
  McpClientEnvelopeSchema,
  McpCredentialEnvelopeSchema,
} from "../../lib/mcp/schemas.ts"

const mcpServerConnectionScopeEnum = pgEnum("mcp_server_connection_scope", [
  "organization",
  "tenant",
  "tenant_user",
])
const mcpConnectionAuthStateEnum = pgEnum("mcp_connection_auth_state", [
  "disconnected",
  "connected",
  "reauthorization_required",
  "refresh_uncertain",
])
const tenantMcpConnectionAuthStateEnum = pgEnum("tenant_mcp_connection_auth_state", [
  "disconnected",
  "connected",
  "reauthorization_required",
  "refresh_uncertain",
])
const mcpOAuthClientMechanismEnum = pgEnum("mcp_oauth_client_mechanism", [
  "pre_registered",
  "cimd",
  "dcr",
])
const tenantMcpOAuthClientMechanismEnum = pgEnum("tenant_mcp_oauth_client_mechanism", [
  "pre_registered",
  "cimd",
  "dcr",
])
const mcpOAuthAttemptStatusEnum = pgEnum("mcp_oauth_attempt_status", [
  "created",
  "authorizing",
  "exchanging",
  "awaiting_completion",
  "completed",
  "failed",
])
const tenantMcpOAuthAttemptStatusEnum = pgEnum("tenant_mcp_oauth_attempt_status", [
  "created",
  "authorizing",
  "exchanging",
  "awaiting_completion",
  "completed",
  "failed",
])

function mcpServerColumns() {
  return {
    id: uuidV7(),
    organizationId: uuid().notNull(),
    name: caseInsensitiveText().notNull(),
    endpointUrl: text().notNull(),
    enabled: boolean().default(true).notNull(),
    authConfig: schemaJsonb(McpAuthConfigSchema).notNull(),
    authRevision: integer().default(0).notNull(),
    lockVersion: lockVersion(),
    ...timestamps(),
  }
}
export const mcpServer = snakeCase.table(
  "mcp_server",
  {
    ...mcpServerColumns(),
    defaultConnectionScope: mcpServerConnectionScopeEnum().default("tenant_user").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.id] }),
    uniqueIndex("mcp_server_name_uidx").on(t.organizationId, t.name),
    deferrableForeignKey({
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
  ],
)
export const tenantMcpServer = snakeCase.table(
  "tenant_mcp_server",
  { ...mcpServerColumns(), tenantId: uuid().notNull(), tenantUserId: uuid() },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.tenantId, t.id] }),
    unique("tenant_mcp_server_name_uidx")
      .on(t.organizationId, t.tenantId, t.tenantUserId, t.name)
      .nullsNotDistinct(),
    deferrableForeignKey({
      columns: [t.organizationId, t.tenantId],
      foreignColumns: [tenant.organizationId, tenant.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      columns: [t.organizationId, t.tenantId, t.tenantUserId],
      foreignColumns: [tenantUser.organizationId, tenantUser.tenantId, tenantUser.id],
    }).onDelete("cascade"),
  ],
)

function mcpClientColumns() {
  return {
    id: uuidV7(),
    organizationId: uuid().notNull(),
    serverAuthRevision: integer().notNull(),
    issuer: text().notNull(),
    resource: text().notNull(),
    redirectUri: text().notNull(),
    clientMetadata: schemaJsonb(Schema.JsonObject).notNull(),
    credentials: encryptedJson({ schema: McpClientEnvelopeSchema }).notNull(),
    expiresAt: timestampWithTimeZone(),
    ...timestamps(),
  }
}
export const mcpOAuthClient = snakeCase.table(
  "mcp_oauth_client",
  {
    ...mcpClientColumns(),
    serverId: uuid().notNull(),
    mechanism: mcpOAuthClientMechanismEnum().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.id] }),
    uniqueIndex("mcp_oauth_client_binding_uidx").on(
      t.organizationId,
      t.serverId,
      t.serverAuthRevision,
      t.issuer,
      t.resource,
    ),
    deferrableForeignKey({
      columns: [t.organizationId, t.serverId],
      foreignColumns: [mcpServer.organizationId, mcpServer.id],
    }).onDelete("cascade"),
  ],
)
export const tenantMcpOAuthClient = snakeCase.table(
  "tenant_mcp_oauth_client",
  {
    ...mcpClientColumns(),
    tenantId: uuid().notNull(),
    tenantUserId: uuid(),
    organizationServerId: uuid(),
    tenantServerId: uuid(),
    mechanism: tenantMcpOAuthClientMechanismEnum().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.tenantId, t.id] }),
    check(
      "tenant_mcp_oauth_client_server_check",
      sql`num_nonnulls(${t.organizationServerId}, ${t.tenantServerId}) = 1`,
    ),
    uniqueIndex("tenant_mcp_oauth_client_binding_uidx").on(
      t.organizationId,
      t.tenantId,
      sql`coalesce(${t.tenantUserId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.organizationServerId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.tenantServerId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.serverAuthRevision,
      t.issuer,
      t.resource,
    ),
    deferrableForeignKey({
      columns: [t.organizationId, t.tenantId],
      foreignColumns: [tenant.organizationId, tenant.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      columns: [t.organizationId, t.tenantId, t.tenantUserId],
      foreignColumns: [tenantUser.organizationId, tenantUser.tenantId, tenantUser.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      columns: [t.organizationId, t.organizationServerId],
      foreignColumns: [mcpServer.organizationId, mcpServer.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      columns: [t.organizationId, t.tenantId, t.tenantServerId],
      foreignColumns: [
        tenantMcpServer.organizationId,
        tenantMcpServer.tenantId,
        tenantMcpServer.id,
      ],
    }).onDelete("cascade"),
  ],
)

function mcpConnectionColumns() {
  return {
    id: uuidV7(),
    organizationId: uuid().notNull(),
    name: caseInsensitiveText().notNull(),
    enabled: boolean().default(true).notNull(),
    authErrorCode: text(),
    serverAuthRevision: integer().notNull(),
    credentials: encryptedJson({ schema: McpCredentialEnvelopeSchema }),
    authGeneration: uuid()
      .default(sql`gen_random_uuid()`)
      .notNull(),
    tokenRevision: integer().default(0).notNull(),
    refreshClaimId: uuid(),
    refreshClaimExpiresAt: timestampWithTimeZone(),
    expiresAt: timestampWithTimeZone(),
    lastVerifiedAt: timestampWithTimeZone(),
    verificationResult: text(),
    grantedScopes: schemaJsonb(Schema.Array(Schema.String))
      .default(sql`'[]'::jsonb`)
      .notNull(),
    lockVersion: lockVersion(),
    ...timestamps(),
  }
}
export const mcpConnection = snakeCase.table(
  "mcp_connection",
  {
    ...mcpConnectionColumns(),
    serverId: uuid().notNull(),
    oauthClientId: uuid(),
    authState: mcpConnectionAuthStateEnum().default("disconnected").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.id] }),
    uniqueIndex("mcp_connection_name_uidx").on(t.organizationId, t.name),
    index("mcp_connection_server_idx").on(t.organizationId, t.serverId),
    deferrableForeignKey({
      columns: [t.organizationId, t.serverId],
      foreignColumns: [mcpServer.organizationId, mcpServer.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      columns: [t.organizationId, t.oauthClientId],
      foreignColumns: [mcpOAuthClient.organizationId, mcpOAuthClient.id],
      deferrable: "deferred",
    }).onDelete("no action"),
  ],
)
export const tenantMcpConnection = snakeCase.table(
  "tenant_mcp_connection",
  {
    ...mcpConnectionColumns(),
    tenantId: uuid().notNull(),
    tenantUserId: uuid(),
    organizationServerId: uuid(),
    tenantServerId: uuid(),
    organizationOAuthClientId: uuid(),
    tenantOAuthClientId: uuid(),
    authState: tenantMcpConnectionAuthStateEnum().default("disconnected").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.tenantId, t.id] }),
    unique("tenant_mcp_connection_name_uidx")
      .on(t.organizationId, t.tenantId, t.tenantUserId, t.name)
      .nullsNotDistinct(),
    index("tenant_mcp_connection_server_idx").on(t.organizationId, t.tenantId, t.tenantServerId),
    index("tenant_mcp_connection_organization_server_idx").on(
      t.organizationId,
      t.organizationServerId,
    ),
    check(
      "tenant_mcp_connection_server_check",
      sql`num_nonnulls(${t.organizationServerId}, ${t.tenantServerId}) = 1`,
    ),
    check(
      "tenant_mcp_connection_client_check",
      sql`num_nonnulls(${t.organizationOAuthClientId}, ${t.tenantOAuthClientId}) <= 1`,
    ),
    deferrableForeignKey({
      columns: [t.organizationId, t.tenantId],
      foreignColumns: [tenant.organizationId, tenant.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      columns: [t.organizationId, t.tenantId, t.tenantUserId],
      foreignColumns: [tenantUser.organizationId, tenantUser.tenantId, tenantUser.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      columns: [t.organizationId, t.organizationServerId],
      foreignColumns: [mcpServer.organizationId, mcpServer.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      columns: [t.organizationId, t.tenantId, t.tenantServerId],
      foreignColumns: [
        tenantMcpServer.organizationId,
        tenantMcpServer.tenantId,
        tenantMcpServer.id,
      ],
    }).onDelete("cascade"),
    deferrableForeignKey({
      columns: [t.organizationId, t.organizationOAuthClientId],
      foreignColumns: [mcpOAuthClient.organizationId, mcpOAuthClient.id],
      deferrable: "deferred",
    }).onDelete("no action"),
    deferrableForeignKey({
      columns: [t.organizationId, t.tenantId, t.tenantOAuthClientId],
      foreignColumns: [
        tenantMcpOAuthClient.organizationId,
        tenantMcpOAuthClient.tenantId,
        tenantMcpOAuthClient.id,
      ],
      deferrable: "deferred",
    }).onDelete("no action"),
  ],
)

function mcpAttemptColumns() {
  return {
    id: uuidV7(),
    organizationId: uuid().notNull(),
    connectionId: uuid().notNull(),
    actor: schemaJsonb(McpActorSchema).notNull(),
    stateHash: text().notNull(),
    browserBindingHash: text(),
    expectedGeneration: uuid().notNull(),
    serverAuthRevision: integer().notNull(),
    payload: encryptedJson({ schema: McpAttemptEnvelopeSchema }),
    expiresAt: timestampWithTimeZone().notNull(),
    failureCode: text(),
    ...timestamps(),
  }
}
export const mcpOAuthAttempt = snakeCase.table(
  "mcp_oauth_attempt",
  { ...mcpAttemptColumns(), status: mcpOAuthAttemptStatusEnum().default("created").notNull() },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.id] }),
    uniqueIndex("mcp_oauth_attempt_state_uidx").on(t.organizationId, t.stateHash),
    index("mcp_oauth_attempt_expiry_idx").on(t.expiresAt),
    deferrableForeignKey({
      columns: [t.organizationId, t.connectionId],
      foreignColumns: [mcpConnection.organizationId, mcpConnection.id],
    }).onDelete("cascade"),
  ],
)
export const tenantMcpOAuthAttempt = snakeCase.table(
  "tenant_mcp_oauth_attempt",
  {
    ...mcpAttemptColumns(),
    tenantId: uuid().notNull(),
    status: tenantMcpOAuthAttemptStatusEnum().default("created").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.tenantId, t.id] }),
    uniqueIndex("tenant_mcp_oauth_attempt_state_uidx").on(
      t.organizationId,
      t.tenantId,
      t.stateHash,
    ),
    index("tenant_mcp_oauth_attempt_expiry_idx").on(t.expiresAt),
    deferrableForeignKey({
      columns: [t.organizationId, t.tenantId, t.connectionId],
      foreignColumns: [
        tenantMcpConnection.organizationId,
        tenantMcpConnection.tenantId,
        tenantMcpConnection.id,
      ],
    }).onDelete("cascade"),
  ],
)

/** @knipignore Drizzle Kit discovers these enums through schema.ts. */
export {
  mcpServerConnectionScopeEnum,
  mcpConnectionAuthStateEnum,
  tenantMcpConnectionAuthStateEnum,
  mcpOAuthClientMechanismEnum,
  tenantMcpOAuthClientMechanismEnum,
  mcpOAuthAttemptStatusEnum,
  tenantMcpOAuthAttemptStatusEnum,
}
