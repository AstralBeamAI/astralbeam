import { createHash, randomBytes } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Option, Redacted, Result, Schema } from "effect"
import {
  extractWWWAuthenticateParams,
  OAuthError,
  refreshAuthorization,
  type OAuthDiscoveryState,
  type OAuthClientInformationMixed,
} from "@modelcontextprotocol/client"
import { SqlClient } from "effect/sql"
import { Database } from "@/db/database"
import { makeDatabaseCache, withDatabaseCacheLock } from "@/db/cache"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials"
import { decryptDatabaseValue, encryptDatabaseValue } from "@/db/lib/encryption"
import { updateWithOptimisticLock } from "@/db/lib/optimistic-locking"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { mcpConnection } from "@/db/schema/mcp"
import { Config } from "@/lib/config/config"
import {
  McpConnections,
  mcpConnectionOwner,
  mcpDecodeCredential,
  type McpStoredConnection,
} from "./mcp.server.ts"
import {
  McpAuthorizationRequired,
  McpChanged,
  McpForbidden,
  McpInvalidConfiguration,
  McpNotFound,
  McpUnavailable,
  MCP_ATTEMPT_LIFETIME_MS,
  MCP_REFRESH_LEASE_MS,
  MCP_REFRESH_MARGIN_MS,
  McpAttemptEnvelopeSchema,
  McpAttemptReferenceSchema,
  mcpActorEquals,
  type McpActor,
  type McpAttemptEnvelope,
  type McpAttemptReference,
  type McpCredentialEnvelope,
  type McpReference,
} from "./schemas.ts"
import { mcpCreateDispatcher } from "./network.server.ts"
import {
  mcpAuthorizationFetch,
  mcpDiscoveryBinding,
  mcpOAuthCredential,
  mcpRunAuthorization,
} from "./provider.server.ts"

export function mcpHashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
export function mcpAttemptLocator(state: string): McpAttemptReference | null {
  try {
    return Schema.decodeUnknownSync(McpAttemptReferenceSchema, { onExcessProperty: "error" })(
      JSON.parse(Buffer.from(state.split(".")[0]!, "base64url").toString("utf8")),
    )
  } catch {
    return null
  }
}
function mcpAttemptKey(reference: {
  organizationId: string
  tenantId: string
  connectionId: string
}) {
  return `${reference.organizationId}:${reference.tenantId}:${reference.connectionId}`
}
type McpAuthorizationInput = { actor: McpActor; reference: McpReference }
type McpCredentialInput = McpAuthorizationInput & {
  rejectedToken?: string | undefined
  expectedVersion?: number | undefined
}

const makeMcpAuthorization = Effect.gen(function* () {
  const db = yield* Database
  const sqlClient = yield* SqlClient.SqlClient
  const connections = yield* McpConnections
  const config = yield* Config
  const attempts = yield* makeDatabaseCache({
    namespace: "mcp-oauth",
    schema: Schema.String,
    timeToLive: "10 minutes",
  })
  const dispatcher = yield* Effect.acquireRelease(Effect.sync(mcpCreateDispatcher), (agent) =>
    Effect.promise(() => agent.close()),
  )
  const guardedAuthFetch = (url: string | URL | Request, init?: RequestInit) =>
    mcpAuthorizationFetch(dispatcher, url, init)
  const baseUrl = Effect.gen(function* () {
    const value = yield* config.get("app_base_url")
    if (!value) return yield* new McpInvalidConfiguration()
    return value
  })
  const readAttempt = Effect.fnUntraced(function* (reference: McpAttemptReference) {
    const stored = yield* attempts.get(mcpAttemptKey(reference)).pipe(Effect.orDie)
    if (Option.isNone(stored)) return yield* new McpNotFound()
    const decoded = decryptDatabaseValue({
      storedValue: stored.value,
      schema: McpAttemptEnvelopeSchema,
      keyring: getDatabaseEncryptionKeyring(),
    })
    if (Result.isFailure(decoded)) return yield* new McpAuthorizationRequired()
    const payload = decoded.success.value
    if (
      payload.attempt.id !== reference.id ||
      payload.attempt.organizationId !== reference.organizationId ||
      payload.attempt.tenantId !== reference.tenantId ||
      payload.attempt.connectionId !== reference.connectionId ||
      payload.expiresAt <= (yield* Clock.currentTimeMillis)
    )
      return yield* new McpAuthorizationRequired()
    return { ...payload }
  })
  const writeAttempt = Effect.fnUntraced(function* (payload: McpAttemptEnvelope) {
    const encrypted = encryptDatabaseValue({
      value: payload,
      schema: McpAttemptEnvelopeSchema,
      keyring: getDatabaseEncryptionKeyring(),
    })
    if (Result.isFailure(encrypted)) return yield* new McpAuthorizationRequired()
    yield* attempts.set(mcpAttemptKey(payload.attempt), encrypted.success).pipe(Effect.orDie)
  })
  const attemptLock = <A, E, R>(reference: McpAttemptReference, effect: Effect.Effect<A, E, R>) =>
    withDatabaseCacheLock({ namespace: "mcp-oauth", key: mcpAttemptKey(reference) }, effect).pipe(
      Effect.catchTag("KeyValueStoreError", Effect.die),
      mapDatabaseErrors(),
      Effect.provideService(SqlClient.SqlClient, sqlClient),
    )
  const persistAttempt = (
    payload: McpAttemptEnvelope,
    expectedStatus: McpAttemptEnvelope["status"] = payload.status,
  ) =>
    attemptLock(
      payload.attempt,
      Effect.gen(function* () {
        const current = yield* readAttempt(payload.attempt)
        if (current.status !== expectedStatus) return yield* new McpChanged()
        yield* writeAttempt(payload)
      }),
    )
  const attemptConnection = Effect.fnUntraced(function* (
    actor: McpActor,
    payload: McpAttemptEnvelope,
  ) {
    if (!mcpActorEquals(actor, payload.actor)) return yield* new McpForbidden()
    const selected = yield* connections.getConnection({
      actor,
      reference: { ...payload.attempt, id: payload.attempt.connectionId },
    })
    if (
      selected.connection.lockVersion !== payload.expectedVersion ||
      selected.server.authConfig.kind !== "oauth"
    )
      return yield* new McpChanged()
    return selected
  })
  const start = Effect.fn("McpAuthorization.start")(function* (
    input: McpAuthorizationInput & { origin: string },
  ) {
    const origin = yield* baseUrl
    const { connection, server } = yield* connections.getConnection(input)
    const authConfig = server.authConfig
    if (authConfig.kind !== "oauth") return yield* new McpInvalidConfiguration()
    if (input.origin !== new URL(origin).origin && input.origin !== authConfig.applicationOrigin)
      return yield* new McpForbidden()
    const challenge = yield* Effect.tryPromise({
      try: async () => {
        const response = await guardedAuthFetch(server.endpointUrl)
        const challenge =
          response.status === 401 ? extractWWWAuthenticateParams(response) : undefined
        await response.body?.cancel()
        return challenge
      },
      catch: () => new McpUnavailable(),
    })
    const client = authConfig.client
    const attempt: McpAttemptReference = {
      organizationId: connection.organizationId,
      tenantId: connection.tenantId,
      id: crypto.randomUUID(),
      connectionId: connection.id,
    }
    const payload: McpAttemptEnvelope = {
      attempt,
      actor: input.actor,
      expectedVersion: connection.lockVersion,
      origin: input.origin,
      expiresAt: (yield* Clock.currentTimeMillis) + MCP_ATTEMPT_LIFETIME_MS,
      status: "authorizing",
      browserBindingHash: null,
      state: `${Buffer.from(JSON.stringify(attempt)).toString("base64url")}.${randomBytes(32).toString("base64url")}`,
      verifier: null,
      discovery: null,
      clientInformation: client
        ? {
            client_id: client.clientId,
            ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
          }
        : null,
      authorizationUrl: null,
      pendingCredential: null,
    }
    yield* attemptLock(attempt, writeAttempt(payload))
    yield* Effect.tryPromise({
      try: () =>
        mcpRunAuthorization({
          payload,
          baseUrl: origin,
          authConfig,
          now: () => Effect.runPromise(Clock.currentTimeMillis),
          dispatcher,
          serverUrl: server.endpointUrl,
          scope: authConfig.requestedScopes.join(" ") || challenge?.scope,
          resourceMetadataUrl: challenge?.resourceMetadataUrl,
        }),
      catch: () => new McpAuthorizationRequired(),
    })
    if (!payload.authorizationUrl) return yield* new McpAuthorizationRequired()
    yield* persistAttempt(payload)
    const popup = new URL("/api/mcp/oauth/connect", origin)
    popup.searchParams.set("attempt", Buffer.from(JSON.stringify(attempt)).toString("base64url"))
    return { attempt, popupUrl: popup.href }
  })
  const bindBrowser = Effect.fn("McpAuthorization.bindBrowser")(function* (input: {
    actor: McpActor
    reference: McpAttemptReference
    challenge: string
  }) {
    if (!/^[\w-]{43}$/.test(input.challenge)) return yield* new McpForbidden()
    yield* attemptLock(
      input.reference,
      Effect.gen(function* () {
        const payload = yield* readAttempt(input.reference)
        yield* attemptConnection(input.actor, payload)
        const bindingHash = mcpHashSecret(input.challenge)
        if (payload.browserBindingHash === bindingHash) return
        if (payload.status !== "authorizing" || payload.browserBindingHash !== null)
          return yield* new McpChanged()
        payload.browserBindingHash = bindingHash
        yield* writeAttempt(payload)
      }),
    )
  })
  const browserRedirect = Effect.fn("McpAuthorization.browserRedirect")(function* (input: {
    reference: McpAttemptReference
    browserBinding: string
    origin: string
  }) {
    const payload = yield* readAttempt(input.reference)
    yield* attemptConnection(payload.actor, payload)
    if (
      payload.origin !== input.origin ||
      payload.status !== "authorizing" ||
      !payload.authorizationUrl
    )
      return yield* new McpForbidden()
    if (payload.browserBindingHash === null) return null
    if (payload.browserBindingHash !== mcpHashSecret(input.browserBinding))
      return yield* new McpForbidden()
    return payload.authorizationUrl
  })
  const callback = Effect.fn("McpAuthorization.callback")(function* (input: {
    params: URLSearchParams
    browserBinding: string
    origin: string
  }) {
    const reference = mcpAttemptLocator(input.params.get("state") ?? "")
    if (!reference) return yield* new McpForbidden()
    const payload = yield* attemptLock(
      reference,
      Effect.gen(function* () {
        const pending = yield* readAttempt(reference)
        yield* attemptConnection(pending.actor, pending)
        if (
          pending.origin !== input.origin ||
          pending.status !== "authorizing" ||
          pending.state !== input.params.get("state") ||
          pending.browserBindingHash !== mcpHashSecret(input.browserBinding) ||
          !pending.discovery
        )
          return yield* new McpForbidden()
        if (input.params.has("error") || !input.params.get("code")) {
          pending.status = "failed"
          yield* writeAttempt(pending)
          return pending
        }
        pending.status = "exchanging"
        yield* writeAttempt(pending)
        return pending
      }),
    )
    if (payload.status === "failed") return yield* new McpAuthorizationRequired()
    const { server } = yield* attemptConnection(payload.actor, payload)
    const authConfig = server.authConfig
    if (authConfig.kind !== "oauth") return yield* new McpInvalidConfiguration()
    const origin = yield* baseUrl
    yield* Effect.tryPromise({
      try: () =>
        mcpRunAuthorization({
          payload,
          baseUrl: origin,
          authConfig,
          now: () => Effect.runPromise(Clock.currentTimeMillis),
          dispatcher,
          serverUrl: server.endpointUrl,
          callback: input.params,
        }),
      catch: () => new McpAuthorizationRequired(),
    }).pipe(
      Effect.catch((error) => {
        payload.status = "failed"
        return persistAttempt(payload, "exchanging").pipe(Effect.andThen(Effect.fail(error)))
      }),
    )
    if (!payload.pendingCredential) {
      payload.status = "failed"
      yield* persistAttempt(payload, "exchanging")
      return yield* new McpAuthorizationRequired()
    }
    payload.status = "awaiting_completion"
    yield* persistAttempt(payload, "exchanging")
    return reference
  })
  const complete = Effect.fn("McpAuthorization.complete")(function* (input: {
    actor: McpActor
    reference: McpAttemptReference
  }) {
    return yield* attemptLock(
      input.reference,
      Effect.gen(function* () {
        const payload = yield* readAttempt(input.reference)
        const { connection } = yield* attemptConnection(input.actor, payload)
        if (payload.status === "authorizing" || payload.status === "exchanging") return false
        if (payload.status !== "awaiting_completion" || !payload.pendingCredential)
          return yield* new McpChanged()
        const envelope: McpCredentialEnvelope = {
          version: 1,
          ...input.actor,
          id: connection.id,
          mcpServerId: connection.mcpServerId,
          lockVersion: payload.expectedVersion + 1,
          credential: payload.pendingCredential,
        }
        yield* updateWithOptimisticLock({
          executor: db,
          table: mcpConnection,
          id: connection.id,
          scope: mcpConnectionOwner(input.actor),
          expectedLockVersion: payload.expectedVersion,
          set: { credentials: envelope },
        }).pipe(
          mapDatabaseErrors(),
          Effect.catchTag("OptimisticLockError", () => Effect.fail(new McpChanged())),
        )
        yield* attempts.remove(mcpAttemptKey(input.reference)).pipe(Effect.orDie)
        return true
      }),
    )
  })
  const refresh = Effect.fnUntraced(function* (
    input: McpCredentialInput,
    connection: McpStoredConnection,
    envelope: McpCredentialEnvelope,
  ) {
    if (envelope.credential.kind !== "oauth") return yield* new McpAuthorizationRequired()
    const credential = envelope.credential
    if (envelope.refreshStartedAt !== undefined) return null
    const predicate = and(
      mcpConnectionOwner(input.actor),
      eq(mcpConnection.id, connection.id),
      eq(mcpConnection.lockVersion, connection.lockVersion),
    )
    const unchanged = and(
      predicate,
      sql`${mcpConnection.credentials} = ${connection.storedCredentials}`,
    )
    if (!credential.tokens.refresh_token) {
      yield* db
        .update(mcpConnection)
        .set({ credentials: { ...envelope, refreshStartedAt: 0 } })
        .where(unchanged)
        .pipe(Effect.orDie)
      return yield* new McpAuthorizationRequired()
    }
    const started = yield* Clock.currentTimeMillis
    const claimed = yield* db
      .update(mcpConnection)
      .set({ credentials: { ...envelope, refreshStartedAt: started } })
      .where(unchanged)
      .returning({ credentials: sql<string>`${mcpConnection.credentials}::text` })
      .pipe(Effect.orDie)
    if (!claimed.length) return null
    const claim = and(predicate, sql`${mcpConnection.credentials} = ${claimed[0]!.credentials}`)
    const discovery = credential.discovery as unknown as OAuthDiscoveryState
    const binding = mcpDiscoveryBinding(discovery)
    const refreshed = yield* Effect.tryPromise({
      try: () =>
        refreshAuthorization(binding.issuer, {
          ...(discovery.authorizationServerMetadata
            ? { metadata: discovery.authorizationServerMetadata }
            : {}),
          clientInformation: credential.clientInformation as OAuthClientInformationMixed,
          refreshToken: credential.tokens.refresh_token!,
          resource: binding.resource,
          fetchFn: guardedAuthFetch,
        }),
      catch: (error) => error,
    }).pipe(
      Effect.flatMap((tokens) =>
        Effect.try({
          try: () =>
            mcpOAuthCredential({
              tokens: { ...tokens, issuer: binding.issuer },
              discovery,
              clientInformation: credential.clientInformation,
              now: started,
              previous: credential,
            }),
          catch: () => new McpAuthorizationRequired(),
        }),
      ),
      Effect.catch((error) => {
        const definite = error instanceof OAuthError
        const reauthorize =
          definite &&
          !["server_error", "temporarily_unavailable", "too_many_requests"].includes(error.code)
        return db
          .update(mcpConnection)
          .set(
            definite
              ? reauthorize
                ? { credentials: null, lockVersion: sql`${mcpConnection.lockVersion} + 1` }
                : { credentials: envelope }
              : { credentials: { ...envelope, refreshStartedAt: started - MCP_REFRESH_LEASE_MS } },
          )
          .where(claim)
          .pipe(
            Effect.orDie,
            Effect.tap(() =>
              Effect.logWarning("MCP refresh failed", {
                connectionId: connection.id,
                category: reauthorize
                  ? "reauthorization_required"
                  : definite
                    ? "transient"
                    : "refresh_uncertain",
              }),
            ),
            Effect.andThen(
              Effect.fail(
                definite && !reauthorize ? new McpUnavailable() : new McpAuthorizationRequired(),
              ),
            ),
          )
      }),
    )
    const updated = yield* db
      .update(mcpConnection)
      .set({ credentials: { ...envelope, credential: refreshed } })
      .where(claim)
      .returning({ id: mcpConnection.id })
      .pipe(Effect.orDie)
    if (!updated.length) return yield* new McpChanged()
    return refreshed
  })
  const getCredential = Effect.fn("McpAuthorization.getCredential")(function* (
    input: McpCredentialInput,
  ) {
    const deadline = (yield* Clock.currentTimeMillis) + MCP_REFRESH_LEASE_MS
    while ((yield* Clock.currentTimeMillis) < deadline) {
      const { connection, server } = yield* connections.getConnection(input)
      if (input.expectedVersion !== undefined && input.expectedVersion !== connection.lockVersion)
        return yield* new McpChanged()
      if (server.authConfig.kind === "none") return Redacted.make({ kind: "none" } as const)
      const envelope = mcpDecodeCredential(connection)
      if (
        !envelope ||
        (envelope.refreshStartedAt !== undefined &&
          envelope.refreshStartedAt + MCP_REFRESH_LEASE_MS <= (yield* Clock.currentTimeMillis))
      )
        return yield* new McpAuthorizationRequired()
      const value = envelope.credential
      if (
        value.kind !== "oauth" ||
        (input.rejectedToken !== value.tokens.access_token &&
          (value.expiresAt === null ||
            value.expiresAt > (yield* Clock.currentTimeMillis) + MCP_REFRESH_MARGIN_MS))
      )
        return Redacted.make(value)
      const refreshed = yield* refresh(input, connection, envelope)
      if (refreshed) {
        const current = yield* connections.getConnection(input)
        if (current.connection.lockVersion !== connection.lockVersion)
          return yield* new McpChanged()
        return Redacted.make(refreshed)
      }
      yield* Effect.sleep("100 millis")
    }
    return yield* new McpUnavailable()
  })
  return {
    start,
    bindBrowser,
    browserRedirect,
    callback,
    complete,
    getCredential,
    disconnect: Effect.fn("McpAuthorization.disconnect")(function* (input: McpAuthorizationInput) {
      const reference = { ...input.reference, connectionId: input.reference.id }
      yield* attemptLock(
        reference,
        connections
          .disconnect(input)
          .pipe(Effect.andThen(attempts.remove(mcpAttemptKey(reference)).pipe(Effect.orDie))),
      )
    }),
  }
})
export class McpAuthorization extends Context.Service<
  McpAuthorization,
  Effect.Success<typeof makeMcpAuthorization>
>()("astralbeam/mcp/authorization/McpAuthorization") {
  static readonly layerNoDeps = Layer.effect(McpAuthorization, makeMcpAuthorization)
  static readonly layer = McpAuthorization.layerNoDeps.pipe(
    Layer.provide([Database.layer, McpConnections.layer, Config.layer]),
  )
}
