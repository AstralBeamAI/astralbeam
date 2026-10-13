import { and, eq, sql } from "drizzle-orm"
import { Clock, Context, Effect, Layer } from "effect"
import { Database } from "@/db/database"
import { updateWithOptimisticLock } from "@/db/lib/optimistic-locking"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { mcpConnection, mcpServer } from "@/db/schema/mcp"
import {
  McpAuthorizationRequired,
  McpChanged,
  McpForbidden,
  McpInvalidConfiguration,
  McpNotFound,
} from "./errors.ts"
import {
  MCP_REFRESH_LEASE_MS,
  type McpActor,
  type McpReference,
  type McpServerWriteSchema,
  type McpServerSummary,
  type McpConnectionSummary,
} from "./schemas.ts"
import {
  mcpConnectionOwner,
  mcpDecodeCredential,
  mcpDecodeServer,
  mcpNewId,
  mcpReadConnections,
  mcpReadServers,
} from "./store.server.ts"
import { mcpHeadersAreAllowed, mcpUrlIsPublic } from "./network.server.ts"

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
    const valid = yield* Effect.try({
      try: () =>
        mcpUrlIsPublic(new URL(fields.endpointUrl)) &&
        (fields.authConfig.kind !== "static_headers" ||
          mcpHeadersAreAllowed(
            Object.fromEntries(fields.authConfig.headerNames.map((name) => [name, ""])),
          )),
      catch: () => new McpInvalidConfiguration(),
    })
    if (!valid) return yield* new McpInvalidConfiguration()
    const id = yield* mcpNewId(db)
    yield* db
      .insert(mcpServer)
      .values({
        organizationId,
        id,
        endpointUrl: new URL(fields.endpointUrl).href,
        authConfig: { organizationId, id, authConfig: fields.authConfig },
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
    return { connection, server: yield* getServer(input.actor.organizationId, connection.serverId) }
  })
  const catalog = Effect.fn("McpConnections.catalog")(function* (actor: McpActor) {
    const now = yield* Clock.currentTimeMillis
    const connections = (yield* mcpReadConnections(db, actor)).map((row): McpConnectionSummary => ({
      organizationId: row.organizationId,
      tenantId: row.tenantId,
      id: row.id,
      serverId: row.serverId,
      lockVersion: row.lockVersion,
      authState:
        row.storedCredentials === null
          ? "disconnected"
          : !mcpDecodeCredential(row) ||
              (row.refreshStartedAt !== null &&
                row.refreshStartedAt.getTime() + MCP_REFRESH_LEASE_MS <= now)
            ? "reauthorization_required"
            : "connected",
    }))
    return { servers: yield* listServers(actor.organizationId), connections }
  })
  const createConnection = Effect.fn("McpConnections.createConnection")(function* (
    actor: McpActor,
    serverId: string,
  ) {
    const server = yield* getServer(actor.organizationId, serverId)
    const id = yield* mcpNewId(db)
    yield* db
      .insert(mcpConnection)
      .values({
        ...actor,
        id,
        serverId,
        credentials:
          server.authConfig.kind === "none"
            ? { version: 1, ...actor, id, serverId, lockVersion: 0, credential: { kind: "none" } }
            : null,
      })
      .onConflictDoNothing()
      .pipe(Effect.orDie)
    const connection = (yield* catalog(actor)).connections.find(
      (entry) => entry.serverId === serverId,
    )!
    if (server.authConfig.kind === "none" && connection.authState === "disconnected") {
      yield* updateWithOptimisticLock({
        executor: db,
        table: mcpConnection,
        id: connection.id,
        scope: mcpConnectionOwner(actor),
        expectedLockVersion: connection.lockVersion,
        set: {
          credentials: {
            version: 1,
            ...actor,
            id: connection.id,
            serverId,
            lockVersion: connection.lockVersion + 1,
            credential: { kind: "none" },
          },
          refreshStartedAt: null,
        },
      }).pipe(
        mapDatabaseErrors(),
        Effect.catchTag("OptimisticLockError", () => Effect.fail(new McpChanged())),
      )
      return {
        ...connection,
        lockVersion: connection.lockVersion + 1,
        authState: "connected" as const,
      }
    }
    return connection
  })
  const setHeaders = Effect.fn("McpConnections.setHeaders")(function* (input: {
    actor: McpActor
    reference: McpReference
    lockVersion: number
    headers: Record<string, string>
  }) {
    const { connection, server } = yield* getConnection(input)
    if (
      server.authConfig.kind !== "static_headers" ||
      !mcpHeadersAreAllowed(input.headers) ||
      server.authConfig.headerNames.length !== Object.keys(input.headers).length ||
      server.authConfig.headerNames.some((name) => !input.headers[name])
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
          serverId: connection.serverId,
          lockVersion: input.lockVersion + 1,
          credential: { kind: "static_headers", headers: input.headers },
        },
        refreshStartedAt: null,
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
    yield* db
      .update(mcpConnection)
      .set({
        credentials: null,
        refreshStartedAt: null,
        lockVersion: sql`${mcpConnection.lockVersion} + 1`,
      })
      .where(and(mcpConnectionOwner(input.actor), eq(mcpConnection.id, input.reference.id)))
      .pipe(Effect.orDie)
  })
  const removeConnection = Effect.fn("McpConnections.removeConnection")(function* (input: {
    actor: McpActor
    reference: McpReference
  }) {
    yield* db
      .delete(mcpConnection)
      .where(and(mcpConnectionOwner(input.actor), eq(mcpConnection.id, input.reference.id)))
      .pipe(Effect.orDie)
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
    removeConnection,
  }
})
export class McpConnections extends Context.Service<
  McpConnections,
  Effect.Success<typeof makeMcpConnections>
>()("astralbeam/mcp/McpConnections") {
  static readonly layerNoDeps = Layer.effect(McpConnections, makeMcpConnections)
  static readonly layer = McpConnections.layerNoDeps.pipe(Layer.provide(Database.layer))
}
