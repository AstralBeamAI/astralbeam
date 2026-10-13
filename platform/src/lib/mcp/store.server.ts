import { and, asc, desc, gt, lt, eq, isNull, or, sql } from "drizzle-orm"
import { Effect, Result } from "effect"
import type { Database } from "@/db/database"
import { decryptDatabaseValue } from "@/db/lib/encryption"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials"
import {
  mcpConnection,
  mcpOAuthAttempt,
  mcpOAuthClient,
  mcpServer,
  tenantMcpConnection,
  tenantMcpOAuthAttempt,
  tenantMcpOAuthClient,
  tenantMcpServer,
} from "@/db/schema/mcp"
import {
  McpCredentialEnvelopeSchema,
  McpClientEnvelopeSchema,
  McpAttemptEnvelopeSchema,
  mcpOwnerEquals,
  mcpActorEquals,
  mcpReferenceEquals,
  type McpOwner,
  type McpReference,
} from "./schemas.ts"
import { McpAuthorizationRequired } from "./errors.ts"

export function mcpConnectionTable(reference: McpReference | McpOwner) {
  return reference.tenantId === null ? mcpConnection : tenantMcpConnection
}
export function mcpServerTable(reference: McpReference | McpOwner) {
  return reference.tenantId === null ? mcpServer : tenantMcpServer
}
export function mcpClientTable(reference: McpReference | McpOwner) {
  return reference.tenantId === null ? mcpOAuthClient : tenantMcpOAuthClient
}
export function mcpAttemptTable(reference: McpReference | McpOwner) {
  return reference.tenantId === null ? mcpOAuthAttempt : tenantMcpOAuthAttempt
}

export function mcpScopePredicate(
  table:
    | ReturnType<typeof mcpConnectionTable>
    | ReturnType<typeof mcpServerTable>
    | ReturnType<typeof mcpClientTable>
    | ReturnType<typeof mcpAttemptTable>,
  reference: McpReference,
) {
  return and(
    eq(table.organizationId, reference.organizationId),
    eq(table.id, reference.id),
    "tenantId" in table ? eq(table.tenantId, reference.tenantId!) : undefined,
  )!
}
export function mcpOwnerPredicate(
  table:
    | typeof mcpServer
    | typeof tenantMcpServer
    | typeof mcpConnection
    | typeof tenantMcpConnection
    | typeof mcpOAuthClient
    | typeof tenantMcpOAuthClient,
  owner: McpOwner,
) {
  return and(
    eq(table.organizationId, owner.organizationId),
    "tenantId" in table ? eq(table.tenantId, owner.tenantId!) : undefined,
    "tenantUserId" in table
      ? owner.tenantUserId === null
        ? isNull(table.tenantUserId)
        : eq(table.tenantUserId, owner.tenantUserId)
      : undefined,
  )
}

export function mcpOwnerValues(owner: McpOwner) {
  return owner.tenantId === null
    ? { organizationId: owner.organizationId }
    : {
        organizationId: owner.organizationId,
        tenantId: owner.tenantId,
        tenantUserId: owner.tenantUserId,
      }
}

export function mcpServerValues(
  table: ReturnType<typeof mcpConnectionTable> | ReturnType<typeof mcpClientTable>,
  server: McpReference,
) {
  return "serverId" in table
    ? { serverId: server.id }
    : {
        organizationServerId: server.tenantId === null ? server.id : null,
        tenantServerId: server.tenantId !== null ? server.id : null,
      }
}

export function mcpServerPredicate(table: ReturnType<typeof mcpClientTable>, server: McpReference) {
  return "serverId" in table
    ? eq(table.serverId, server.id)
    : server.tenantId === null
      ? eq(table.organizationServerId, server.id)
      : eq(table.tenantServerId, server.id)
}

export function mcpClientValues(
  table: ReturnType<typeof mcpConnectionTable>,
  client: McpReference | null,
) {
  return "oauthClientId" in table
    ? { oauthClientId: client?.id ?? null }
    : {
        organizationOAuthClientId: client?.tenantId === null ? client.id : null,
        tenantOAuthClientId: client && client.tenantId !== null ? client.id : null,
      }
}

function mcpIdentityColumns(
  table:
    | ReturnType<typeof mcpServerTable>
    | ReturnType<typeof mcpConnectionTable>
    | ReturnType<typeof mcpClientTable>
    | ReturnType<typeof mcpAttemptTable>,
) {
  return {
    id: table.id,
    organizationId: table.organizationId,
    tenantId: "tenantId" in table ? table.tenantId : sql<string | null>`null`,
  }
}

function mcpServerReferenceColumns(
  table: ReturnType<typeof mcpConnectionTable> | ReturnType<typeof mcpClientTable>,
) {
  return {
    serverId:
      "serverId" in table
        ? table.serverId
        : sql<string>`coalesce(${table.organizationServerId}, ${table.tenantServerId})`,
    serverTenantId:
      "tenantId" in table
        ? sql<
            string | null
          >`case when ${table.tenantServerId} is not null then ${table.tenantId} end`
        : sql<string | null>`null`,
  }
}

export const mcpReadServer = Effect.fnUntraced(function* (
  db: typeof Database.Service,
  reference: McpReference,
) {
  const table = mcpServerTable(reference)
  const [row] = yield* db
    .select({
      ...mcpIdentityColumns(table),
      tenantUserId: "tenantUserId" in table ? table.tenantUserId : sql<string | null>`null`,
      name: table.name,
      endpointUrl: table.endpointUrl,
      enabled: table.enabled,
      authConfig: table.authConfig,
      authRevision: table.authRevision,
      lockVersion: table.lockVersion,
      defaultConnectionScope:
        "defaultConnectionScope" in table
          ? table.defaultConnectionScope
          : sql<
              "tenant" | "tenant_user"
            >`case when ${tenantMcpServer.tenantUserId} is null then 'tenant' else 'tenant_user' end`,
    })
    .from(table)
    .where(mcpScopePredicate(table, reference))
    .limit(1)
    .pipe(Effect.orDie)
  return row ?? null
})
export type McpStoredServer = NonNullable<Effect.Success<ReturnType<typeof mcpReadServer>>>

export const mcpReadConnection = Effect.fnUntraced(function* (
  db: typeof Database.Service,
  reference: McpReference,
) {
  const table = mcpConnectionTable(reference)
  const [row] = yield* db
    .select({
      ...mcpIdentityColumns(table),
      tenantUserId: "tenantUserId" in table ? table.tenantUserId : sql<string | null>`null`,
      ...mcpServerReferenceColumns(table),
      oauthClientId:
        "oauthClientId" in table
          ? table.oauthClientId
          : sql<
              string | null
            >`coalesce(${tenantMcpConnection.organizationOAuthClientId}, ${tenantMcpConnection.tenantOAuthClientId})`,
      oauthClientTenantId:
        "tenantId" in table
          ? sql<
              string | null
            >`case when ${tenantMcpConnection.tenantOAuthClientId} is not null then ${tenantMcpConnection.tenantId} end`
          : sql<string | null>`null`,
      name: table.name,
      enabled: table.enabled,
      authState: table.authState,
      authErrorCode: table.authErrorCode,
      authGeneration: table.authGeneration,
      tokenRevision: table.tokenRevision,
      refreshClaimId: table.refreshClaimId,
      refreshClaimExpiresAt: table.refreshClaimExpiresAt,
      serverAuthRevision: table.serverAuthRevision,
      lockVersion: table.lockVersion,
      expiresAt: table.expiresAt,
      grantedScopes: table.grantedScopes,
      lastVerifiedAt: table.lastVerifiedAt,
      verificationResult: table.verificationResult,
      storedCredentials: sql<string | null>`${table.credentials}::text`,
    })
    .from(table)
    .where(mcpScopePredicate(table, reference))
    .limit(1)
    .pipe(Effect.orDie)
  return row ?? null
})
export type McpStoredConnection = NonNullable<Effect.Success<ReturnType<typeof mcpReadConnection>>>

export function mcpConnectionSummary(
  row: McpStoredConnection,
  server: McpStoredServer | undefined,
  canManage: boolean,
  interactive: boolean,
) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    tenantId: row.tenantId,
    tenantUserId: row.tenantUserId,
    serverId: row.serverId,
    serverTenantId: row.serverTenantId,
    name: row.name,
    enabled: row.enabled,
    authState: row.authState,
    ...(server ? { authKind: server.authConfig.kind } : {}),
    allowedActions: canManage
      ? ([
          "update",
          "delete",
          "disconnect",
          ...(row.enabled && server?.enabled ? ["test"] : []),
          ...(interactive && server?.authConfig.kind === "oauth" ? ["authorize"] : []),
        ] as ("update" | "delete" | "disconnect" | "test" | "authorize")[])
      : [],
    authErrorCode: row.authErrorCode,
    lockVersion: row.lockVersion,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    grantedScopes: row.grantedScopes,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    verificationResult: row.verificationResult,
  }
}

export function mcpDecodeCredential(row: McpStoredConnection) {
  const decoded = decryptDatabaseValue({
    storedValue: row.storedCredentials,
    schema: McpCredentialEnvelopeSchema,
    keyring: getDatabaseEncryptionKeyring(),
  })
  if (Result.isFailure(decoded)) return null
  const envelope = decoded.success.value
  return mcpOwnerEquals(envelope.owner, row) &&
    mcpReferenceEquals(envelope.connection, row) &&
    mcpReferenceEquals(envelope.server, {
      organizationId: row.organizationId,
      tenantId: row.serverTenantId,
      id: row.serverId,
    }) &&
    envelope.serverAuthRevision === row.serverAuthRevision &&
    envelope.authGeneration === row.authGeneration &&
    envelope.tokenRevision === row.tokenRevision &&
    (envelope.credential.kind !== "oauth" ||
      mcpReferenceEquals(envelope.credential.clientRegistration, {
        organizationId: row.organizationId,
        tenantId: row.oauthClientTenantId,
        id: row.oauthClientId ?? "",
      }))
    ? envelope
    : null
}

export const mcpReadClient = Effect.fnUntraced(function* (
  db: Pick<typeof Database.Service, "select">,
  reference: McpReference,
) {
  const table = mcpClientTable(reference)
  const [row] = yield* db
    .select({
      ...mcpIdentityColumns(table),
      ...mcpServerReferenceColumns(table),
      serverAuthRevision: table.serverAuthRevision,
      issuer: table.issuer,
      resource: table.resource,
      redirectUri: table.redirectUri,
      expiresAt: table.expiresAt,
      storedCredentials: sql<string>`${table.credentials}::text`,
    })
    .from(table)
    .where(mcpScopePredicate(table, reference))
    .limit(1)
    .pipe(Effect.orDie)
  if (!row) return yield* new McpAuthorizationRequired()
  const decoded = decryptDatabaseValue({
    storedValue: row.storedCredentials,
    schema: McpClientEnvelopeSchema,
    keyring: getDatabaseEncryptionKeyring(),
  })
  if (Result.isFailure(decoded)) return yield* new McpAuthorizationRequired()
  const envelope = decoded.success.value
  if (
    (row.expiresAt &&
      row.expiresAt.getTime() <= (yield* Effect.clockWith((clock) => clock.currentTimeMillis))) ||
    !mcpReferenceEquals(envelope.registration, row) ||
    !mcpReferenceEquals(envelope.server, {
      organizationId: row.organizationId,
      tenantId: row.serverTenantId,
      id: row.serverId,
    }) ||
    envelope.serverAuthRevision !== row.serverAuthRevision ||
    envelope.issuer !== row.issuer ||
    envelope.resource !== row.resource
  )
    return yield* new McpAuthorizationRequired()
  return { ...envelope, redirectUri: row.redirectUri }
})

export const mcpReadAttempt = Effect.fnUntraced(function* (
  db: typeof Database.Service,
  reference: McpReference,
) {
  const table = mcpAttemptTable(reference)
  const [row] = yield* db
    .select({
      ...mcpIdentityColumns(table),
      connectionId: table.connectionId,
      actor: table.actor,
      status: table.status,
      stateHash: table.stateHash,
      browserBindingHash: table.browserBindingHash,
      expectedGeneration: table.expectedGeneration,
      serverAuthRevision: table.serverAuthRevision,
      expiresAt: table.expiresAt,
      storedPayload: sql<string | null>`${table.payload}::text`,
    })
    .from(table)
    .where(mcpScopePredicate(table, reference))
    .limit(1)
    .pipe(Effect.orDie)
  if (!row) return null
  const decoded = decryptDatabaseValue({
    storedValue: row.storedPayload,
    schema: McpAttemptEnvelopeSchema,
    keyring: getDatabaseEncryptionKeyring(),
  })
  const payload = Result.isSuccess(decoded) ? decoded.success.value : null
  if (
    payload &&
    (!mcpReferenceEquals(payload.attempt, row) ||
      !mcpReferenceEquals(payload.connection, { ...row, id: row.connectionId }) ||
      !mcpActorEquals(payload.actor, row.actor) ||
      payload.expectedGeneration !== row.expectedGeneration ||
      payload.serverAuthRevision !== row.serverAuthRevision)
  )
    return null
  return { ...row, payload }
})

export const mcpListReferences = Effect.fnUntraced(function* (
  db: typeof Database.Service,
  owner: McpOwner,
  kind: "server" | "connection",
  page?: { position?: { id: string } | undefined; backward?: boolean | undefined; limit: number },
) {
  const table = kind === "server" ? mcpServerTable(owner) : mcpConnectionTable(owner)
  return yield* db
    .select(mcpIdentityColumns(table))
    .from(table)
    .where(
      and(
        mcpOwnerPredicate(table, owner),
        page?.position
          ? page.backward
            ? lt(table.id, page.position.id)
            : gt(table.id, page.position.id)
          : undefined,
      ),
    )
    .orderBy(page?.backward ? desc(table.id) : asc(table.id))
    .limit(page?.limit ?? 1000)
    .pipe(Effect.orDie)
})

export const mcpEffectiveReferences = Effect.fnUntraced(function* (
  db: typeof Database.Service,
  owner: McpOwner,
  kind: "server" | "connection",
) {
  const organizationTable = kind === "server" ? mcpServer : mcpConnection
  const shared = yield* db
    .select(mcpIdentityColumns(organizationTable))
    .from(organizationTable)
    .where(eq(organizationTable.organizationId, owner.organizationId))
    .orderBy(asc(organizationTable.id))
    .pipe(Effect.orDie)
  if (owner.tenantId === null) return shared
  const table = kind === "server" ? tenantMcpServer : tenantMcpConnection
  const personal = yield* db
    .select({ id: table.id, organizationId: table.organizationId, tenantId: table.tenantId })
    .from(table)
    .where(
      and(
        eq(table.organizationId, owner.organizationId),
        eq(table.tenantId, owner.tenantId),
        or(
          isNull(table.tenantUserId),
          owner.tenantUserId ? eq(table.tenantUserId, owner.tenantUserId) : undefined,
        ),
      ),
    )
    .orderBy(asc(table.id))
    .pipe(Effect.orDie)
  return [...shared, ...personal]
})
