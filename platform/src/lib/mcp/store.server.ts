import { and, eq, sql } from "drizzle-orm"
import { Effect, Result, Schema } from "effect"
import type { Database } from "@/db/database"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials"
import { decryptDatabaseValue, encryptDatabaseValue } from "@/db/lib/encryption"
import { mcpConnection, mcpServer } from "@/db/schema/mcp"
import {
  McpCredentialEnvelopeSchema,
  McpStoredAuthConfigSchema,
  McpClientEnvelopeSchema,
  mcpActorEquals,
  type McpActor,
  type McpAuthConfig,
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
      storedConfig: sql<unknown>`${mcpServer.authConfig}`,
    })
    .from(mcpServer)
    .where(eq(mcpServer.organizationId, organizationId))
    .orderBy(mcpServer.id)
    .pipe(Effect.orDie)
})
export function mcpEncodeServer(row: {
  organizationId: string
  id: string
  authConfig: McpAuthConfig
}): typeof McpStoredAuthConfigSchema.Type {
  if (row.authConfig.kind !== "oauth") return row.authConfig
  const { client, ...authConfig } = row.authConfig
  return {
    ...authConfig,
    ...(client
      ? {
          client: Result.getOrThrow(
            encryptDatabaseValue({
              value: { organizationId: row.organizationId, id: row.id, client },
              schema: McpClientEnvelopeSchema,
              keyring: getDatabaseEncryptionKeyring(),
            }),
          ),
        }
      : {}),
  }
}
export function mcpDecodeServer(
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
