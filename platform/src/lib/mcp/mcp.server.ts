import { and, eq, sql } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Result, Schema } from "effect"
import { Database } from "@/db/database"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials"
import { decryptDatabaseValue, encryptDatabaseValue } from "@/db/lib/encryption"
import { updateWithOptimisticLock } from "@/db/lib/optimistic-locking"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { mcpConnection, mcpServer } from "@/db/schema/mcp"
import {
  McpAuthorizationRequired,
  McpChanged,
  McpForbidden,
  McpInvalidConfiguration,
  McpNotFound,
  MCP_REFRESH_LEASE_MS,
  McpCredentialEnvelopeSchema,
  McpStoredAuthConfigSchema,
  McpClientEnvelopeSchema,
  McpServerWriteSchema,
  mcpActorEquals,
  mcpHeadersAreAllowed,
  type McpActor,
  type McpAuthConfig,
  type McpReference,
  type McpServerSummary,
  type McpConnectionSummary,
} from "./schemas.ts"
import { mcpUrlIsPublic } from "./network.server.ts"

export function mcpConnectionOwner(actor: McpActor) {
  return and(
    eq(mcpConnection.organizationId, actor.organizationId),
    eq(mcpConnection.tenantId, actor.tenantId),
    eq(mcpConnection.tenantUserId, actor.tenantUserId),
  )!
}
const mcpReadServers = Effect.fnUntraced(function* (
  db: Pick<typeof Database.Service, "select">,
  organizationId: string,
) {
  return yield* db
    .select({
      organizationId: mcpServer.organizationId,
      id: mcpServer.id,
      endpointUrl: mcpServer.endpointUrl,
      storedConfig: sql<unknown>`${mcpServer.authConfig}`,
    })
    .from(mcpServer)
    .where(eq(mcpServer.organizationId, organizationId))
    .orderBy(mcpServer.id)
    .pipe(Effect.orDie)
})
function mcpEncodeServer(row: {
  organizationId: string
  id: string
  authConfig: McpAuthConfig
}): typeof McpStoredAuthConfigSchema.Type {
  if (row.authConfig.kind !== "oauth") return row.authConfig
  const { client, ...authConfig } = row.authConfig
  if (!client) return authConfig
  return {
    ...authConfig,
    client: Result.getOrThrow(
      encryptDatabaseValue({
        value: { organizationId: row.organizationId, id: row.id, client },
        schema: McpClientEnvelopeSchema,
        keyring: getDatabaseEncryptionKeyring(),
      }),
    ),
  }
}
function mcpDecodeServer(
  row: Effect.Success<ReturnType<typeof mcpReadServers>>[number],
): McpAuthConfig | null {
  const decoded = Schema.decodeUnknownResult(McpStoredAuthConfigSchema, {
    onExcessProperty: "error",
  })(row.storedConfig)
  if (Result.isFailure(decoded)) return null
  if (decoded.success.kind !== "oauth") return decoded.success
  const { client, ...authConfig } = decoded.success
  if (!client) return authConfig.profile === "google" ? null : authConfig
  const decrypted = decryptDatabaseValue({
    storedValue: client,
    schema: McpClientEnvelopeSchema,
    keyring: getDatabaseEncryptionKeyring(),
  })
  return Result.isSuccess(decrypted) &&
    decrypted.success.value.organizationId === row.organizationId &&
    decrypted.success.value.id === row.id
    ? { ...authConfig, client: decrypted.success.value.client }
    : null
}
const mcpReadConnections = Effect.fnUntraced(function* (
  db: Pick<typeof Database.Service, "select">,
  actor: McpActor,
) {
  return yield* db
    .select({
      organizationId: mcpConnection.organizationId,
      tenantId: mcpConnection.tenantId,
      id: mcpConnection.id,
      tenantUserId: mcpConnection.tenantUserId,
      mcpServerId: mcpConnection.mcpServerId,
      lockVersion: mcpConnection.lockVersion,
      storedCredentials: sql<string | null>`${mcpConnection.credentials}::text`,
    })
    .from(mcpConnection)
    .where(mcpConnectionOwner(actor))
    .orderBy(mcpConnection.id)
    .pipe(Effect.orDie)
})
export type McpStoredConnection = Effect.Success<ReturnType<typeof mcpReadConnections>>[number]
export function mcpDecodeCredential(row: McpStoredConnection) {
  const decoded = decryptDatabaseValue({
    storedValue: row.storedCredentials,
    schema: McpCredentialEnvelopeSchema,
    keyring: getDatabaseEncryptionKeyring(),
  })
  if (Result.isFailure(decoded)) return null
  const envelope = decoded.success.value
  return mcpActorEquals(envelope, row) &&
    envelope.id === row.id &&
    envelope.mcpServerId === row.mcpServerId &&
    envelope.lockVersion === row.lockVersion
    ? envelope
    : null
}

const makeMcpConnections = Effect.gen(function* () {
  const db = yield* Database
  const listServers = Effect.fn("McpConnections.listServers")(function* (organizationId: string) {
    return (yield* mcpReadServers(db, organizationId)).map((row): McpServerSummary => {
      const config = mcpDecodeServer(row)
      return {
        organizationId: row.organizationId,
        id: row.id,
        endpointUrl: row.endpointUrl,
        authKind: config?.kind ?? null,
        headerNames: config?.kind === "static_headers" ? [...config.headerNames] : [],
      }
    })
  })
  const getServer = Effect.fn("McpConnections.getServer")(function* (
    organizationId: string,
    id: string,
  ) {
    const row = (yield* mcpReadServers(db, organizationId)).find((entry) => entry.id === id)
    if (!row) return yield* new McpNotFound()
    const authConfig = mcpDecodeServer(row)
    if (!authConfig) return yield* new McpAuthorizationRequired()
    return { organizationId, id, endpointUrl: row.endpointUrl, authConfig }
  })
  const createServer = Effect.fn("McpConnections.createServer")(function* (
    organizationId: string,
    fields: typeof McpServerWriteSchema.Type,
  ) {
    const endpoint = yield* Effect.try({
      try: () => new URL(fields.endpointUrl),
      catch: () => new McpInvalidConfiguration(),
    })
    if (
      !Schema.is(McpServerWriteSchema.fields.endpointUrl)(endpoint.href) ||
      !mcpUrlIsPublic(endpoint)
    )
      return yield* new McpInvalidConfiguration()
    const [generated] = yield* db
      .select({ id: sql<string>`uuidv7()` })
      .from(sql`(values (1)) as generated(value)`)
      .pipe(Effect.orDie)
    const id = generated!.id
    yield* db
      .insert(mcpServer)
      .values({
        organizationId,
        id,
        endpointUrl: endpoint.href,
        authConfig: mcpEncodeServer({ organizationId, id, authConfig: fields.authConfig }),
      })
      .pipe(mapDatabaseErrors({ mcp_server_endpoint_uidx: () => new McpChanged() }))
    return (yield* listServers(organizationId)).find((entry) => entry.id === id)!
  })
  const removeServer = Effect.fn("McpConnections.removeServer")(function* (
    organizationId: string,
    id: string,
  ) {
    const rows = yield* db
      .delete(mcpServer)
      .where(and(eq(mcpServer.organizationId, organizationId), eq(mcpServer.id, id)))
      .returning({ id: mcpServer.id })
      .pipe(Effect.orDie)
    if (!rows.length) return yield* new McpNotFound()
  })
  const getConnection = Effect.fn("McpConnections.getConnection")(function* (input: {
    actor: McpActor
    reference: McpReference
  }) {
    if (
      input.reference.organizationId !== input.actor.organizationId ||
      input.reference.tenantId !== input.actor.tenantId
    )
      return yield* new McpForbidden()
    const connection = (yield* mcpReadConnections(db, input.actor)).find(
      (entry) => entry.id === input.reference.id,
    )
    if (!connection) return yield* new McpNotFound()
    return {
      connection,
      server: yield* getServer(input.actor.organizationId, connection.mcpServerId),
    }
  })
  const catalog = Effect.fn("McpConnections.catalog")(function* (actor: McpActor) {
    const now = yield* Clock.currentTimeMillis
    const servers = yield* listServers(actor.organizationId)
    const connections = (yield* mcpReadConnections(db, actor)).map((row): McpConnectionSummary => {
      const credential = mcpDecodeCredential(row)
      return {
        organizationId: row.organizationId,
        tenantId: row.tenantId,
        id: row.id,
        mcpServerId: row.mcpServerId,
        lockVersion: row.lockVersion,
        authState: servers.some(
          (server) => server.id === row.mcpServerId && server.authKind === "none",
        )
          ? "connected"
          : row.storedCredentials === null
            ? row.lockVersion > 0
              ? "reauthorization_required"
              : "disconnected"
            : !credential ||
                (credential.refreshStartedAt !== undefined &&
                  credential.refreshStartedAt + MCP_REFRESH_LEASE_MS <= now)
              ? "reauthorization_required"
              : "connected",
      }
    })
    return { servers, connections }
  })
  const createConnection = Effect.fn("McpConnections.createConnection")(function* (
    actor: McpActor,
    mcpServerId: string,
  ) {
    yield* getServer(actor.organizationId, mcpServerId)
    yield* db
      .insert(mcpConnection)
      .values({ ...actor, mcpServerId })
      .onConflictDoNothing()
      .pipe(Effect.orDie)
    return (yield* catalog(actor)).connections.find((entry) => entry.mcpServerId === mcpServerId)!
  })
  const setHeaders = Effect.fn("McpConnections.setHeaders")(function* (input: {
    actor: McpActor
    reference: McpReference
    lockVersion: number
    headers: Record<string, string>
  }) {
    const { connection, server } = yield* getConnection(input)
    const headers = yield* Effect.try({
      try: () => Object.fromEntries(new Headers(input.headers)),
      catch: () => new McpInvalidConfiguration(),
    })
    if (
      server.authConfig.kind !== "static_headers" ||
      !mcpHeadersAreAllowed(input.headers) ||
      server.authConfig.headerNames.length !== Object.keys(input.headers).length ||
      server.authConfig.headerNames.some((name) => !headers[name.toLowerCase()])
    )
      return yield* new McpInvalidConfiguration()
    yield* updateWithOptimisticLock({
      executor: db,
      table: mcpConnection,
      id: connection.id,
      scope: mcpConnectionOwner(input.actor),
      expectedLockVersion: input.lockVersion,
      set: {
        credentials: {
          version: 1,
          ...input.actor,
          id: connection.id,
          mcpServerId: connection.mcpServerId,
          lockVersion: input.lockVersion + 1,
          credential: { kind: "static_headers", headers },
        },
      },
    }).pipe(
      mapDatabaseErrors(),
      Effect.catchTag("OptimisticLockError", () => Effect.fail(new McpChanged())),
    )
  })
  const disconnect = Effect.fn("McpConnections.disconnect")(function* (input: {
    actor: McpActor
    reference: McpReference
  }) {
    const removed = yield* db
      .delete(mcpConnection)
      .where(
        and(
          mcpConnectionOwner(input.actor),
          eq(mcpConnection.id, input.reference.id),
          eq(mcpConnection.organizationId, input.reference.organizationId),
          eq(mcpConnection.tenantId, input.reference.tenantId),
        ),
      )
      .returning({ id: mcpConnection.id })
      .pipe(Effect.orDie)
    if (!removed.length) return yield* new McpNotFound()
  })
  return {
    listServers,
    getServer,
    createServer,
    removeServer,
    catalog,
    getConnection,
    createConnection,
    setHeaders,
    disconnect,
  }
})
export class McpConnections extends Context.Service<
  McpConnections,
  Effect.Success<typeof makeMcpConnections>
>()("astralbeam/mcp/McpConnections") {
  static readonly layerNoDeps = Layer.effect(McpConnections, makeMcpConnections)
  static readonly layer = McpConnections.layerNoDeps.pipe(Layer.provide(Database.layer))
}
