import { databasePage, type DatabasePageOptions } from "@/db/lib/pagination"
import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "@/db/database"
import { organizationConfiguration, tenantUser } from "@/db/schema/organizations"
import { mcpConnection } from "@/db/schema/mcp"
import { deleteWithOptimisticLock, updateWithOptimisticLock } from "@/db/lib/optimistic-locking"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import {
  McpAuthorizationRequired,
  McpChanged,
  McpForbidden,
  McpInvalidConfiguration,
  McpNameTaken,
  McpNotFound,
} from "./errors.ts"
import {
  McpConnectionWriteSchema,
  McpServerWriteSchema,
  type McpActor,
  type McpOwner,
  type McpPolicy,
  type McpReference,
  mcpOwnerEquals,
  mcpOwnerFor,
  mcpReferenceFor,
} from "./schemas.ts"
import {
  mcpConnectionSummary,
  mcpConnectionTable,
  mcpEffectiveReferences,
  mcpListReferences,
  mcpReadConnection,
  mcpReadServer,
  mcpScopePredicate,
  mcpAttemptTable,
  mcpServerTable,
  mcpOwnerValues,
  mcpServerValues,
  mcpClientValues,
  type McpStoredServer,
} from "./store.server.ts"
import { mcpHeadersAreAllowed, mcpUrlIsPublic } from "./network.server.ts"

function mcpActorCanManage(actor: McpActor, owner: McpOwner): boolean {
  if (actor.organizationId !== owner.organizationId) return false
  if (owner.tenantUserId !== null)
    return actor.tenantUserId === owner.tenantUserId && actor.tenantId === owner.tenantId
  if (actor.tenantId === null) return actor.organizationUserId !== null || actor.apiKey
  return owner.tenantId === actor.tenantId && actor.admin
}
function mcpActorCanUse(actor: McpActor, owner: McpOwner): boolean {
  return (
    actor.organizationId === owner.organizationId &&
    (owner.tenantId === null ||
      (owner.tenantUserId === null &&
        actor.tenantId === null &&
        (actor.organizationUserId !== null || actor.apiKey)) ||
      (actor.tenantId === owner.tenantId &&
        (owner.tenantUserId === null || actor.tenantUserId === owner.tenantUserId)))
  )
}
export function mcpDefinitionAllowed(policy: McpPolicy, owner: McpOwner): boolean {
  return (
    owner.tenantId === null ||
    (owner.tenantUserId === null ? policy.allowTenantMcpServers : policy.allowTenantUserMcpServers)
  )
}
export function mcpServerAcceptsOwner(server: McpStoredServer, owner: McpOwner): boolean {
  if (server.organizationId !== owner.organizationId) return false
  if (server.tenantId !== null) return mcpOwnerEquals(server, owner)
  return server.defaultConnectionScope === "organization"
    ? owner.tenantId === null
    : server.defaultConnectionScope === "tenant"
      ? owner.tenantId !== null && owner.tenantUserId === null
      : owner.tenantId !== null && owner.tenantUserId !== null
}

const mcpMapWrites = mapDatabaseErrors({
  mcp_server_name_uidx: () => new McpNameTaken(),
  tenant_mcp_server_name_uidx: () => new McpNameTaken(),
  mcp_connection_name_uidx: () => new McpNameTaken(),
  tenant_mcp_connection_name_uidx: () => new McpNameTaken(),
})

type McpSaveServer = {
  actor: McpActor
  owner: McpOwner
  id?: string | undefined
  fields: typeof McpServerWriteSchema.Type
}
type McpSaveConnection = {
  actor: McpActor
  owner: McpOwner
  id?: string | undefined
  fields: typeof McpConnectionWriteSchema.Type
}
type McpAccessConnection = { actor: McpActor; reference: McpReference; use?: boolean }
type McpOwnedInput = { actor: McpActor; owner: McpOwner }
type McpPageInput = McpOwnedInput & { page: DatabasePageOptions }
type McpListInput = McpOwnedInput & { page?: Parameters<typeof mcpListReferences>[3] }

const makeMcpConnections = Effect.gen(function* () {
  const db = yield* Database
  const policy = Effect.fn("McpConnections.policy")(function* (organizationId: string) {
    const [row] = yield* db
      .select({
        allowTenantMcpServers: organizationConfiguration.allowTenantMcpServers,
        allowTenantUserMcpServers: organizationConfiguration.allowTenantUserMcpServers,
        lockVersion: organizationConfiguration.lockVersion,
      })
      .from(organizationConfiguration)
      .where(eq(organizationConfiguration.organizationId, organizationId))
      .limit(1)
      .pipe(Effect.orDie)
    return row ?? { allowTenantMcpServers: false, allowTenantUserMcpServers: false, lockVersion: 0 }
  })
  const savePolicy = Effect.fn("McpConnections.savePolicy")(function* (input: {
    actor: McpActor
    policy: McpPolicy
  }) {
    if (
      !mcpActorCanManage(input.actor, {
        organizationId: input.actor.organizationId,
        tenantId: null,
        tenantUserId: null,
      })
    )
      return yield* new McpForbidden()
    const [row] = yield* db
      .select({ id: organizationConfiguration.id })
      .from(organizationConfiguration)
      .where(eq(organizationConfiguration.organizationId, input.actor.organizationId))
      .limit(1)
      .pipe(Effect.orDie)
    if (!row) return yield* new McpNotFound()
    yield* updateWithOptimisticLock({
      executor: db,
      table: organizationConfiguration,
      id: row.id,
      scope: eq(organizationConfiguration.organizationId, input.actor.organizationId),
      expectedLockVersion: input.policy.lockVersion,
      set: {
        allowTenantMcpServers: input.policy.allowTenantMcpServers,
        allowTenantUserMcpServers: input.policy.allowTenantUserMcpServers,
      },
    }).pipe(
      Effect.catchTag("OptimisticLockError", () => Effect.fail(new McpChanged())),
      Effect.catchTag("EffectDrizzleQueryError", Effect.die),
    )
    return yield* policy(input.actor.organizationId)
  })
  const getServer = Effect.fn("McpConnections.getServer")(function* (input: McpAccessConnection) {
    if (input.actor.organizationId !== input.reference.organizationId)
      return yield* new McpNotFound()
    const server = yield* mcpReadServer(db, input.reference)
    if (
      !server ||
      ("tenantUserId" in input.reference && input.reference.tenantUserId !== server.tenantUserId) ||
      !(input.use ? mcpActorCanUse(input.actor, server) : mcpActorCanManage(input.actor, server))
    )
      return yield* new McpNotFound()
    if (
      input.use &&
      (!server.enabled || !mcpDefinitionAllowed(yield* policy(server.organizationId), server))
    )
      return yield* new McpForbidden()
    return server
  })
  const getConnection = Effect.fn("McpConnections.getConnection")(function* (
    input: McpAccessConnection,
  ) {
    if (input.actor.organizationId !== input.reference.organizationId)
      return yield* new McpNotFound()
    if (input.use && input.actor.tenantId !== null) {
      if (input.actor.tenantUserId === null) return yield* new McpForbidden()
      const [member] = yield* db
        .select({ id: tenantUser.id })
        .from(tenantUser)
        .where(
          and(
            eq(tenantUser.organizationId, input.actor.organizationId),
            eq(tenantUser.tenantId, input.actor.tenantId),
            eq(tenantUser.id, input.actor.tenantUserId),
          ),
        )
        .limit(1)
        .pipe(Effect.orDie)
      if (!member) return yield* new McpForbidden()
    }
    const connection = yield* mcpReadConnection(db, input.reference)
    if (
      !connection ||
      ("tenantUserId" in input.reference &&
        input.reference.tenantUserId !== connection.tenantUserId) ||
      !(input.use
        ? mcpActorCanUse(input.actor, connection)
        : mcpActorCanManage(input.actor, connection))
    )
      return yield* new McpNotFound()
    const server = yield* mcpReadServer(db, {
      organizationId: connection.organizationId,
      tenantId: connection.serverTenantId,
      id: connection.serverId,
    })
    if (!server) return yield* new McpNotFound()
    if (
      input.use &&
      (!connection.enabled ||
        !server.enabled ||
        !mcpServerAcceptsOwner(server, connection) ||
        !mcpDefinitionAllowed(yield* policy(server.organizationId), server))
    )
      return yield* new McpForbidden()
    if (input.use && connection.serverAuthRevision !== server.authRevision)
      return yield* new McpAuthorizationRequired()
    return { connection, server }
  })
  const listServers = Effect.fn("McpConnections.listServers")(function* (input: McpListInput) {
    if (!mcpActorCanManage(input.actor, input.owner)) return yield* new McpForbidden()
    return yield* Effect.forEach(
      yield* mcpListReferences(db, input.owner, "server", input.page),
      (reference) => getServer({ actor: input.actor, reference }),
    )
  })
  const listConnections = Effect.fn("McpConnections.listConnections")(function* (
    input: McpListInput,
  ) {
    if (!mcpActorCanManage(input.actor, input.owner)) return yield* new McpForbidden()
    return yield* Effect.forEach(
      yield* mcpListReferences(db, input.owner, "connection", input.page),
      (reference) =>
        Effect.map(getConnection({ actor: input.actor, reference }), ({ connection, server }) =>
          mcpConnectionSummary(connection, server, true, input.actor.interactive),
        ),
    )
  })
  const pageServers = Effect.fn("McpConnections.pageServers")((input: McpPageInput) =>
    databasePage(input.page, (position, limit, backward) =>
      listServers({ ...input, page: { position, limit, backward } }),
    ),
  )
  const pageConnections = Effect.fn("McpConnections.pageConnections")((input: McpPageInput) =>
    databasePage(input.page, (position, limit, backward) =>
      listConnections({ ...input, page: { position, limit, backward } }),
    ),
  )
  const saveServer = Effect.fn("McpConnections.saveServer")(function* (input: McpSaveServer) {
    if (
      !mcpActorCanManage(input.actor, input.owner) ||
      !mcpDefinitionAllowed(yield* policy(input.owner.organizationId), input.owner)
    )
      return yield* new McpForbidden()
    const allowed = yield* Effect.try({
      try: () =>
        mcpUrlIsPublic(new URL(input.fields.endpointUrl)) &&
        (input.fields.authConfig.kind !== "static_headers" ||
          mcpHeadersAreAllowed(
            Object.fromEntries(input.fields.authConfig.headerNames.map((name) => [name, ""])),
          )),
      catch: () => new McpInvalidConfiguration(),
    })
    if (!allowed) return yield* new McpInvalidConfiguration()
    const existing = input.id
      ? yield* getServer({ actor: input.actor, reference: { ...input.owner, id: input.id } })
      : null
    if (
      existing &&
      (!mcpOwnerEquals(existing, input.owner) || existing.lockVersion !== input.fields.lockVersion)
    )
      return yield* new McpChanged()
    const { lockVersion: _version, defaultConnectionScope, ...fields } = input.fields
    const authChanged =
      existing &&
      (existing.endpointUrl !== fields.endpointUrl ||
        JSON.stringify(existing.authConfig) !== JSON.stringify(fields.authConfig) ||
        existing.defaultConnectionScope !== defaultConnectionScope)
    const table = mcpServerTable(input.owner)
    const values = {
      ...fields,
      authRevision: (existing?.authRevision ?? 0) + (authChanged ? 1 : 0),
      ...("defaultConnectionScope" in table ? { defaultConnectionScope } : {}),
    }
    const reference = yield* db
      .transaction((transaction) =>
        Effect.gen(function* () {
          if (existing) {
            yield* updateWithOptimisticLock({
              executor: transaction,
              table,
              id: existing.id,
              scope: mcpScopePredicate(table, existing),
              expectedLockVersion: existing.lockVersion,
              set: values,
            })
            return existing
          }
          const [row] = yield* transaction
            .insert(table)
            .values({ ...mcpOwnerValues(input.owner), ...values })
            .returning({ id: table.id })
          if (
            input.owner.tenantId === null &&
            fields.authConfig.kind === "none" &&
            defaultConnectionScope === "organization"
          )
            yield* transaction.insert(mcpConnection).values({
              organizationId: input.owner.organizationId,
              serverId: row!.id,
              serverAuthRevision: values.authRevision,
              name: `${fields.name} default`,
              enabled: fields.enabled,
              authState: "connected",
            })
          return { ...input.owner, id: row!.id }
        }),
      )
      .pipe(
        mcpMapWrites,
        Effect.catchTag("OptimisticLockError", () => Effect.fail(new McpChanged())),
      )
    return yield* getServer({ actor: input.actor, reference })
  })
  const saveConnection = Effect.fn("McpConnections.saveConnection")(function* (
    input: McpSaveConnection,
  ) {
    if (!mcpActorCanManage(input.actor, input.owner)) return yield* new McpForbidden()
    const reference = {
      ...input.owner,
      id: input.fields.serverId,
      tenantId: input.fields.serverTenantId,
    }
    const server = yield* mcpReadServer(db, reference)
    if (!server || !mcpServerAcceptsOwner(server, input.owner)) return yield* new McpNotFound()
    if (!server.enabled || !mcpDefinitionAllowed(yield* policy(server.organizationId), server))
      return yield* new McpForbidden()
    const existing = input.id
      ? (yield* getConnection({
          actor: input.actor,
          reference: { ...input.owner, id: input.id },
        })).connection
      : null
    if (
      existing &&
      (!mcpOwnerEquals(existing, input.owner) ||
        existing.serverId !== server.id ||
        existing.serverTenantId !== server.tenantId ||
        existing.lockVersion !== input.fields.lockVersion)
    )
      return yield* new McpChanged()
    if (
      input.fields.headers &&
      (server.authConfig.kind !== "static_headers" ||
        !mcpHeadersAreAllowed(input.fields.headers) ||
        Object.keys(input.fields.headers).length !== server.authConfig.headerNames.length ||
        server.authConfig.headerNames.some((name) => !Object.hasOwn(input.fields.headers!, name)))
    )
      return yield* new McpInvalidConfiguration()
    if (server.authConfig.kind === "static_headers" && !existing && !input.fields.headers)
      return yield* new McpInvalidConfiguration()
    const result = yield* db
      .transaction((transaction) =>
        Effect.gen(function* () {
          const values = {
            name: input.fields.name,
            enabled: input.fields.enabled,
            serverAuthRevision: server.authRevision,
          }
          const table = mcpConnectionTable(input.owner)
          if (existing) {
            yield* updateWithOptimisticLock({
              executor: transaction,
              table,
              id: existing.id,
              scope: mcpScopePredicate(table, existing),
              expectedLockVersion: existing.lockVersion,
              set: { name: values.name, enabled: values.enabled },
            })
          }
          const row = existing ?? {
            ...input.owner,
            ...(yield* transaction
              .insert(table)
              .values({
                ...values,
                ...mcpOwnerValues(input.owner),
                ...mcpServerValues(table, server),
              })
              .returning({ id: table.id }))[0]!,
          }
          if (server.authConfig.kind === "none" || input.fields.headers) {
            const generation = crypto.randomUUID()
            yield* transaction
              .update(table)
              .set({
                authState: "connected",
                authErrorCode: null,
                authGeneration: generation,
                tokenRevision: 0,
                refreshClaimId: null,
                refreshClaimExpiresAt: null,
                expiresAt: null,
                grantedScopes: [],
                ...mcpClientValues(table, null),
                serverAuthRevision: server.authRevision,
                credentials: input.fields.headers
                  ? {
                      version: 1,
                      owner: mcpOwnerFor(input.owner),
                      connection: mcpReferenceFor(row),
                      server: mcpReferenceFor(reference),
                      serverAuthRevision: server.authRevision,
                      authGeneration: generation,
                      tokenRevision: 0,
                      credential: { kind: "static_headers", headers: input.fields.headers },
                    }
                  : null,
              })
              .where(mcpScopePredicate(table, row))
          }
          return row
        }),
      )
      .pipe(
        mcpMapWrites,
        Effect.catchTag("OptimisticLockError", () => Effect.fail(new McpChanged())),
      )
    return mcpConnectionSummary(
      (yield* getConnection({ actor: input.actor, reference: result })).connection,
      server,
      true,
      input.actor.interactive,
    )
  })
  const remove = Effect.fn("McpConnections.remove")(function* (input: {
    actor: McpActor
    reference: McpReference
    kind: "server" | "connection"
    lockVersion: number
  }) {
    if (input.kind === "server") yield* getServer(input)
    else yield* getConnection(input)
    const table =
      input.kind === "server"
        ? mcpServerTable(input.reference)
        : mcpConnectionTable(input.reference)
    yield* db
      .transaction((transaction) =>
        Effect.gen(function* () {
          yield* transaction.execute(sql`set constraints all deferred`)
          yield* deleteWithOptimisticLock({
            executor: transaction,
            table,
            id: input.reference.id,
            scope: mcpScopePredicate(table, input.reference),
            expectedLockVersion: input.lockVersion,
          })
        }),
      )
      .pipe(
        Effect.catchTag("OptimisticLockError", () => Effect.fail(new McpChanged())),
        Effect.catchTag(["EffectDrizzleQueryError", "SqlError"], Effect.die),
      )
  })
  const disconnect = Effect.fn("McpConnections.disconnect")(function* (input: McpAccessConnection) {
    yield* getConnection(input)
    const table = mcpConnectionTable(input.reference)
    yield* db
      .transaction((transaction) =>
        Effect.gen(function* () {
          yield* transaction
            .update(table)
            .set({
              authState: "disconnected",
              authErrorCode: null,
              authGeneration: crypto.randomUUID(),
              credentials: null,
              expiresAt: null,
              grantedScopes: [],
              refreshClaimId: null,
              refreshClaimExpiresAt: null,
              tokenRevision: 0,
            })
            .where(mcpScopePredicate(table, input.reference))
          const attempts = mcpAttemptTable(input.reference)
          yield* transaction
            .update(attempts)
            .set({ status: "failed", failureCode: "disconnected", payload: null })
            .where(
              and(
                eq(attempts.organizationId, input.reference.organizationId),
                "tenantId" in attempts
                  ? eq(attempts.tenantId, input.reference.tenantId!)
                  : undefined,
                eq(attempts.connectionId, input.reference.id),
              ),
            )
        }),
      )
      .pipe(Effect.orDie)
  })
  const recordVerification = Effect.fn("McpConnections.recordVerification")(function* (
    input: McpAccessConnection & { generation: string; result: "connected" | "unavailable" },
  ) {
    const table = mcpConnectionTable(input.reference)
    yield* db
      .update(table)
      .set({ lastVerifiedAt: new Date(), verificationResult: input.result })
      .where(
        and(mcpScopePredicate(table, input.reference), eq(table.authGeneration, input.generation)),
      )
      .pipe(Effect.orDie)
  })
  const catalog = Effect.fn("McpConnections.catalog")(function* (actor: McpActor) {
    const servers = yield* Effect.forEach(
      yield* mcpEffectiveReferences(db, actor, "server"),
      (reference) => mcpReadServer(db, reference),
    )
    const connections = yield* Effect.forEach(
      yield* mcpEffectiveReferences(db, actor, "connection"),
      (reference) => mcpReadConnection(db, reference),
    )
    const effectivePolicy = yield* policy(actor.organizationId)
    return {
      policy: effectivePolicy,
      servers: servers.filter((row) => row !== null),
      connections: connections
        .filter((row) => row !== null)
        .map((row) => {
          const server = servers.find(
            (candidate) =>
              candidate?.id === row.serverId && candidate.tenantId === row.serverTenantId,
          )
          const availability =
            !server || server.authRevision !== row.serverAuthRevision
              ? ("configuration_changed" as const)
              : !mcpDefinitionAllowed(effectivePolicy, server)
                ? ("policy_denied" as const)
                : !row.enabled || !server.enabled
                  ? ("disabled" as const)
                  : ("available" as const)
          return {
            ...mcpConnectionSummary(
              row,
              server ?? undefined,
              mcpActorCanManage(actor, row),
              actor.interactive,
            ),
            availability,
          }
        }),
    }
  })
  return {
    policy,
    savePolicy,
    listServers,
    pageServers,
    pageConnections,
    listConnections,
    getServer,
    getConnection,
    saveServer,
    saveConnection,
    remove,
    disconnect,
    recordVerification,
    catalog,
  }
})

export class McpConnections extends Context.Service<
  McpConnections,
  Effect.Success<typeof makeMcpConnections>
>()("astralbeam/mcp/McpConnections") {
  static readonly layerNoDeps = Layer.effect(McpConnections, makeMcpConnections)
  static readonly layer = McpConnections.layerNoDeps.pipe(Layer.provide(Database.layer))
}
