import { and, eq, sql } from "drizzle-orm"
import { Effect, Result } from "effect"
import type { Database } from "@/db/database"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials"
import { decryptDatabaseValue } from "@/db/lib/encryption"
import { mcpConnection, mcpServer } from "@/db/schema/mcp"
import {
  McpCredentialEnvelopeSchema,
  McpServerEnvelopeSchema,
  mcpActorEquals,
  type McpActor,
} from "./schemas.ts"

export function mcpConnectionOwner(actor: McpActor) {
  return and(
    eq(mcpConnection.organizationId, actor.organizationId),
    eq(mcpConnection.tenantId, actor.tenantId),
    eq(mcpConnection.tenantUserId, actor.tenantUserId),
  )!
}
export const mcpNewId = Effect.fnUntraced(function* (db: Pick<typeof Database.Service, "select">) {
  const [row] = yield* db
    .select({ id: sql<string>`uuidv7()` })
    .from(sql`(values (1)) as generated(value)`)
    .pipe(Effect.orDie)
  return row!.id
})
export const mcpReadServers = Effect.fnUntraced(function* (
  db: Pick<typeof Database.Service, "select">,
  organizationId: string,
) {
  return yield* db
    .select({
      organizationId: mcpServer.organizationId,
      id: mcpServer.id,
      endpointUrl: mcpServer.endpointUrl,
      storedConfig: sql<string>`${mcpServer.authConfig}::text`,
    })
    .from(mcpServer)
    .where(eq(mcpServer.organizationId, organizationId))
    .orderBy(mcpServer.id)
    .pipe(Effect.orDie)
})
export function mcpDecodeServer(row: Effect.Success<ReturnType<typeof mcpReadServers>>[number]) {
  const decoded = decryptDatabaseValue({
    storedValue: row.storedConfig,
    schema: McpServerEnvelopeSchema,
    keyring: getDatabaseEncryptionKeyring(),
  })
  if (
    Result.isFailure(decoded) ||
    decoded.success.value.organizationId !== row.organizationId ||
    decoded.success.value.id !== row.id
  )
    return null
  return decoded.success.value.authConfig
}
export const mcpReadConnections = Effect.fnUntraced(function* (
  db: Pick<typeof Database.Service, "select">,
  actor: McpActor,
) {
  return yield* db
    .select({
      organizationId: mcpConnection.organizationId,
      tenantId: mcpConnection.tenantId,
      id: mcpConnection.id,
      tenantUserId: mcpConnection.tenantUserId,
      serverId: mcpConnection.serverId,
      lockVersion: mcpConnection.lockVersion,
      refreshStartedAt: mcpConnection.refreshStartedAt,
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
    envelope.serverId === row.serverId &&
    envelope.lockVersion === row.lockVersion
    ? envelope
    : null
}
