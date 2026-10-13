import { createHash, randomBytes } from "node:crypto"
import { and, eq, gt, isNull, sql } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Option, Redacted, Result, Schema } from "effect"
import {
  discoverOAuthServerInfo,
  extractWWWAuthenticateParams,
  OAuthError,
  refreshAuthorization,
  validateAuthorizationResponseIssuer,
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
import { McpConnections } from "../mcp.server.ts"
import {
  McpAuthorizationRequired,
  McpChanged,
  McpForbidden,
  McpInvalidConfiguration,
  McpNotFound,
  McpUnavailable,
} from "../errors.ts"
import {
  MCP_ATTEMPT_LIFETIME_MS,
  MCP_AUTH_TIMEOUT_MS,
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
} from "../schemas.ts"
import {
  mcpConnectionOwner,
  mcpDecodeCredential,
  type McpStoredConnection,
} from "../store.server.ts"
import { mcpCreateDispatcher, mcpGuardedFetch } from "../network.server.ts"
import {
  mcpAttemptProvider,
  mcpClientMetadata,
  mcpDiscoveryBinding,
  mcpOAuthCredential,
  mcpRunAuthorization,
} from "./provider.ts"

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
    mcpGuardedFetch(dispatcher, url, {
      ...init,
      signal: AbortSignal.any([
        ...(init?.signal ? [init.signal] : []),
        AbortSignal.timeout(MCP_AUTH_TIMEOUT_MS),
      ]),
    })
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
  const persistAttempt = (payload: McpAttemptEnvelope) =>
    attemptLock(
      payload.attempt,
      Effect.gen(function* () {
        const current = yield* readAttempt(payload.attempt)
        if (current.status !== payload.status) return yield* new McpChanged()
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
  const start = Effect.fn("McpAuthorization.start")(function* (input: McpAuthorizationInput) {
    const origin = yield* baseUrl
    const { connection, server } = yield* connections.getConnection(input)
    if (server.authConfig.kind !== "oauth") return yield* new McpInvalidConfiguration()
    let challengedScope: string | undefined
    const discovery = yield* Effect.tryPromise({
      try: () =>
        discoverOAuthServerInfo(server.endpointUrl, {
          fetchFn: async (url, init) => {
            const response = await guardedAuthFetch(url, init)
            if (
              new URL(url instanceof Request ? url.url : url).href === server.endpointUrl &&
              response.status === 401
            )
              challengedScope = extractWWWAuthenticateParams(response).scope
            return response
          },
        }),
      catch: () => new McpUnavailable(),
    })
    const binding = yield* Effect.try({
      try: () => mcpDiscoveryBinding(discovery, server.endpointUrl),
      catch: () => new McpInvalidConfiguration(),
    })
    const metadata = mcpClientMetadata(origin)
    const prior = mcpDecodeCredential(connection)?.credential
    const client = server.authConfig.client
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
      expiresAt: (yield* Clock.currentTimeMillis) + MCP_ATTEMPT_LIFETIME_MS,
      status: "authorizing",
      browserBindingHash: null,
      state: `${Buffer.from(JSON.stringify(attempt)).toString("base64url")}.${randomBytes(32).toString("base64url")}`,
      verifier: null,
      discovery: Schema.decodeUnknownSync(Schema.JsonObject)(discovery),
      clientInformation: client
        ? {
            client_id: client.clientId,
            ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
            token_endpoint_auth_method: client.tokenEndpointAuthMethod,
            issuer: binding.issuer,
            redirect_uris: metadata.redirect_uris,
          }
        : prior?.kind === "oauth" &&
            prior.clientInformation.issuer === binding.issuer &&
            Array.isArray(prior.clientInformation.redirect_uris) &&
            prior.clientInformation.redirect_uris.includes(metadata.redirect_uris[0]!)
          ? prior.clientInformation
          : null,
      authorizationUrl: null,
      pendingCredential: null,
    }
    yield* attemptLock(attempt, writeAttempt(payload))
    const provider = mcpAttemptProvider({
      payload,
      baseUrl: origin,
      serverUrl: server.endpointUrl,
      authConfig: server.authConfig,
      now: () => Effect.runPromise(Clock.currentTimeMillis),
      persist: () => Effect.runPromise(persistAttempt(payload)),
    })
    const scope = server.authConfig.requestedScopes.length
      ? server.authConfig.requestedScopes.join(" ")
      : (challengedScope ?? discovery.resourceMetadata?.scopes_supported?.join(" "))
    yield* Effect.tryPromise({
      try: () =>
        mcpRunAuthorization({
          provider,
          dispatcher,
          serverUrl: server.endpointUrl,
          scope: scope || undefined,
        }),
      catch: () => new McpAuthorizationRequired(),
    })
    if (!payload.authorizationUrl) return yield* new McpAuthorizationRequired()
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
        if (payload.status !== "authorizing" || payload.browserBindingHash !== null)
          return yield* new McpChanged()
        payload.browserBindingHash = mcpHashSecret(input.challenge)
        yield* writeAttempt(payload)
      }),
    )
  })
  const browserRedirect = Effect.fn("McpAuthorization.browserRedirect")(function* (input: {
    reference: McpAttemptReference
    browserBinding: string
  }) {
    const payload = yield* readAttempt(input.reference)
    yield* attemptConnection(payload.actor, payload)
    if (
      payload.status !== "authorizing" ||
      payload.browserBindingHash !== mcpHashSecret(input.browserBinding) ||
      !payload.authorizationUrl
    )
      return yield* new McpForbidden()
    return payload.authorizationUrl
  })
  const callback = Effect.fn("McpAuthorization.callback")(function* (input: {
    params: URLSearchParams
    browserBinding: string
  }) {
    const reference = mcpAttemptLocator(input.params.get("state") ?? "")
    if (!reference) return yield* new McpForbidden()
    const payload = yield* attemptLock(
      reference,
      Effect.gen(function* () {
        const pending = yield* readAttempt(reference)
        yield* attemptConnection(pending.actor, pending)
        if (
          pending.status !== "authorizing" ||
          pending.state !== input.params.get("state") ||
          pending.browserBindingHash !== mcpHashSecret(input.browserBinding) ||
          !pending.discovery
        )
          return yield* new McpForbidden()
        yield* Effect.try({
          try: () =>
            validateAuthorizationResponseIssuer({
              iss: input.params.get("iss") ?? undefined,
              expectedIssuer: (pending.discovery as unknown as OAuthDiscoveryState)
                .authorizationServerMetadata?.issuer,
              issParameterSupported:
                (pending.discovery as unknown as OAuthDiscoveryState).authorizationServerMetadata
                  ?.authorization_response_iss_parameter_supported === true,
            }),
          catch: () => new McpForbidden(),
        })
        if (input.params.has("error") || !input.params.get("code"))
          return yield* new McpAuthorizationRequired()
        pending.status = "exchanging"
        yield* writeAttempt(pending)
        return pending
      }),
    )
    const { server } = yield* attemptConnection(payload.actor, payload)
    if (server.authConfig.kind !== "oauth") return yield* new McpInvalidConfiguration()
    const origin = yield* baseUrl
    const provider = mcpAttemptProvider({
      payload,
      baseUrl: origin,
      serverUrl: server.endpointUrl,
      authConfig: server.authConfig,
      now: () => Effect.runPromise(Clock.currentTimeMillis),
      persist: () => Effect.runPromise(persistAttempt(payload)),
    })
    yield* Effect.tryPromise({
      try: () =>
        mcpRunAuthorization({
          provider,
          dispatcher,
          serverUrl: server.endpointUrl,
          callback: input.params,
        }),
      catch: () => new McpAuthorizationRequired(),
    })
    if (!payload.pendingCredential) return yield* new McpAuthorizationRequired()
    yield* attemptLock(
      reference,
      Effect.gen(function* () {
        const current = yield* readAttempt(reference)
        if (current.status !== "exchanging") return yield* new McpChanged()
        payload.status = "awaiting_completion"
        yield* writeAttempt(payload)
      }),
    )
    return reference
  })
  const complete = Effect.fn("McpAuthorization.complete")(function* (input: {
    actor: McpActor
    reference: McpAttemptReference
  }) {
    yield* attemptLock(
      input.reference,
      Effect.gen(function* () {
        const payload = yield* readAttempt(input.reference)
        const { connection } = yield* attemptConnection(input.actor, payload)
        if (payload.status !== "awaiting_completion" || !payload.pendingCredential)
          return yield* new McpChanged()
        const envelope: McpCredentialEnvelope = {
          version: 1,
          ...input.actor,
          id: connection.id,
          serverId: connection.serverId,
          lockVersion: payload.expectedVersion + 1,
          credential: payload.pendingCredential,
        }
        yield* updateWithOptimisticLock({
          executor: db,
          table: mcpConnection,
          id: connection.id,
          scope: mcpConnectionOwner(input.actor),
          expectedLockVersion: payload.expectedVersion,
          set: { credentials: envelope, refreshStartedAt: null },
        }).pipe(
          mapDatabaseErrors(),
          Effect.catchTag("OptimisticLockError", () => Effect.fail(new McpChanged())),
        )
        yield* attempts.remove(mcpAttemptKey(input.reference)).pipe(Effect.orDie)
      }),
    )
  })
  const refresh = Effect.fnUntraced(function* (
    input: McpCredentialInput,
    connection: McpStoredConnection,
    serverUrl: string,
    envelope: McpCredentialEnvelope,
  ) {
    if (envelope.credential.kind !== "oauth") return yield* new McpAuthorizationRequired()
    const credential = envelope.credential
    if (!credential.tokens.refresh_token) return yield* new McpAuthorizationRequired()
    if (connection.refreshStartedAt) {
      if (
        connection.refreshStartedAt.getTime() + MCP_REFRESH_LEASE_MS <=
        (yield* Clock.currentTimeMillis)
      )
        return yield* new McpAuthorizationRequired()
      return null
    }
    const started = new Date(yield* Clock.currentTimeMillis)
    const predicate = and(
      mcpConnectionOwner(input.actor),
      eq(mcpConnection.id, connection.id),
      eq(mcpConnection.lockVersion, connection.lockVersion),
      sql`${mcpConnection.credentials} = ${connection.storedCredentials}`,
    )
    const claimed = yield* db
      .update(mcpConnection)
      .set({ refreshStartedAt: started })
      .where(and(predicate, isNull(mcpConnection.refreshStartedAt)))
      .returning({ id: mcpConnection.id })
      .pipe(Effect.orDie)
    if (!claimed.length) return null
    const claim = and(predicate, eq(mcpConnection.refreshStartedAt, started))
    const discovery = credential.discovery as unknown as OAuthDiscoveryState
    const binding = mcpDiscoveryBinding(discovery, serverUrl)
    const tokens = yield* Effect.tryPromise({
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
      Effect.catch((error) => {
        const definite = error instanceof OAuthError
        return db
          .update(mcpConnection)
          .set(
            definite
              ? {
                  refreshStartedAt: null,
                  ...(error.code === "invalid_grant"
                    ? { credentials: null, lockVersion: sql`${mcpConnection.lockVersion} + 1` }
                    : {}),
                }
              : { refreshStartedAt: new Date(started.getTime() - MCP_REFRESH_LEASE_MS) },
          )
          .where(claim)
          .pipe(
            Effect.orDie,
            Effect.tap(() =>
              Effect.logWarning("MCP refresh failed", {
                connectionId: connection.id,
                category: definite
                  ? error.code === "invalid_grant"
                    ? "reauthorization_required"
                    : "transient"
                  : "refresh_uncertain",
              }),
            ),
            Effect.andThen(
              Effect.fail(
                definite && error.code !== "invalid_grant"
                  ? new McpUnavailable()
                  : new McpAuthorizationRequired(),
              ),
            ),
          )
      }),
    )
    const refreshed = yield* Effect.try({
      try: () =>
        mcpOAuthCredential({
          tokens: { ...tokens, issuer: binding.issuer },
          discovery,
          clientInformation: credential.clientInformation,
          serverUrl,
          now: started.getTime(),
          previous: credential,
        }),
      catch: () => new McpAuthorizationRequired(),
    })
    const updated = yield* db
      .update(mcpConnection)
      .set({ credentials: { ...envelope, credential: refreshed }, refreshStartedAt: null })
      .where(and(claim, gt(mcpConnection.refreshStartedAt, sql`now() - interval '30 seconds'`)))
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
      const envelope = mcpDecodeCredential(connection)
      if (
        !envelope ||
        (connection.refreshStartedAt &&
          connection.refreshStartedAt.getTime() + MCP_REFRESH_LEASE_MS <=
            (yield* Clock.currentTimeMillis))
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
      const refreshed = yield* refresh(input, connection, server.endpointUrl, envelope)
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
  const disconnect = Effect.fn("McpAuthorization.disconnect")(function* (
    input: McpAuthorizationInput,
  ) {
    yield* connections.getConnection(input)
    yield* connections.disconnect(input)
    yield* attempts
      .remove(mcpAttemptKey({ ...input.reference, connectionId: input.reference.id }))
      .pipe(Effect.orDie)
  })
  return { start, bindBrowser, browserRedirect, callback, complete, getCredential, disconnect }
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
