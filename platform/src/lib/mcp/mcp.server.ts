import { and, eq } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Schema } from "effect"
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
  McpApplicationOriginSchema,
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
  mcpEncodeServer,
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
          (new Set(fields.authConfig.headerNames).size === fields.authConfig.headerNames.length &&
            mcpHeadersAreAllowed(
              Object.fromEntries(fields.authConfig.headerNames.map((name) => [name, ""])),
            ))),
      catch: () => new McpInvalidConfiguration(),
    })
    if (!valid) return yield* new McpInvalidConfiguration()
    if (
      fields.authConfig.kind === "oauth" &&
      fields.authConfig.applicationOrigin &&
      !Schema.is(McpApplicationOriginSchema)(fields.authConfig.applicationOrigin)
    )
      return yield* new McpInvalidConfiguration()
    const id = yield* mcpNewId(db)
    yield* db
      .insert(mcpServer)
      .values({
        organizationId,
        id,
        endpointUrl: new URL(fields.endpointUrl).href,
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
    const id = yield* mcpNewId(db)
    yield* db
      .insert(mcpConnection)
      .values({ ...actor, id, mcpServerId })
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
          mcpServerId: connection.mcpServerId,
          lockVersion: input.lockVersion + 1,
          credential: { kind: "static_headers", headers: input.headers },
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
