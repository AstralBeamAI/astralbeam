import { createHash, randomBytes } from "node:crypto"
import { and, eq, gt, isNull, sql } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Redacted, Schema } from "effect"
import {
  discoverOAuthServerInfo,
  extractWWWAuthenticateParams,
  OAuthError,
  refreshAuthorization,
  validateAuthorizationResponseIssuer,
  type OAuthDiscoveryState,
  type OAuthClientInformationMixed,
  type StoredOAuthClientInformation,
} from "@modelcontextprotocol/client"
import { Database } from "@/db/database"
import { Config } from "@/lib/config/config"
import { mcpDefinitionAllowed, McpConnections } from "../mcp.server.ts"
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
  McpReferenceSchema,
  mcpReferenceFor,
  mcpOwnerFor,
  mcpOwnerEquals,
  type McpActor,
  type McpAttemptEnvelope,
  type McpCredential,
  type McpCredentialEnvelope,
  type McpManualClient,
  type McpReference,
} from "../schemas.ts"
import {
  mcpAttemptTable,
  mcpClientTable,
  mcpConnectionTable,
  mcpDecodeCredential,
  mcpReadAttempt,
  mcpReadClient,
  mcpScopePredicate,
  mcpServerTable,
  mcpOwnerPredicate,
  mcpOwnerValues,
  mcpServerValues,
  mcpServerPredicate,
  mcpClientValues,
  type McpStoredConnection,
  type McpStoredServer,
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
export function mcpActorMatches(left: McpActor, right: McpActor): boolean {
  return (
    mcpOwnerEquals(left, right) &&
    left.organizationUserId === right.organizationUserId &&
    left.apiKey === right.apiKey
  )
}
export function mcpAttemptLocator(state: string): McpReference | null {
  try {
    return Schema.decodeUnknownSync(McpReferenceSchema, { onExcessProperty: "error" })(
      JSON.parse(Buffer.from(state.split(".")[0]!, "base64url").toString("utf8")),
    )
  } catch {
    return null
  }
}

type McpAuthorizeInput = {
  actor: McpActor
  reference: McpReference
  manualClient?: McpManualClient | undefined
}
type McpAttemptInput = { actor: McpActor; reference: McpReference }
type McpRuntimeCredentialInput = {
  actor: McpActor
  reference: McpReference
  rejectedToken?: string | undefined
  expectedGeneration?: McpStoredConnection["authGeneration"] | undefined
}

function mcpManualClientInformation(client: McpManualClient, issuer: string) {
  return {
    client_id: client.clientId,
    ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    issuer,
  }
}

const makeMcpAuthorization = Effect.gen(function* () {
  const db = yield* Database
  const connections = yield* McpConnections
  const config = yield* Config
  const requireMcpBaseUrl = Effect.gen(function* () {
    const value = yield* config.get("app_base_url")
    if (!value) return yield* new McpInvalidConfiguration()
    return value
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
  const persistAttempt = Effect.fnUntraced(function* (payload: McpAttemptEnvelope) {
    const table = mcpAttemptTable(payload.attempt)
    const updated = yield* db
      .update(table)
      .set({ payload })
      .where(
        and(
          mcpScopePredicate(table, payload.attempt),
          gt(table.expiresAt, sql`now()`),
          eq(table.expectedGeneration, payload.expectedGeneration),
          sql`${table.status} in ('created', 'authorizing', 'exchanging')`,
        ),
      )
      .returning({ id: table.id })
      .pipe(Effect.orDie)
    if (!updated.length) return yield* new McpChanged()
  })

  const saveRegistration = Effect.fnUntraced(function* (input: {
    owner: McpActor | McpStoredConnection | McpStoredServer
    server: McpStoredServer
    discovery: OAuthDiscoveryState
    information: StoredOAuthClientInformation
    manual?: boolean
  }) {
    const binding = mcpDiscoveryBinding(input.discovery, input.server.endpointUrl)
    if (input.information.issuer !== binding.issuer) return yield* new McpInvalidConfiguration()
    const table = mcpClientTable(input.owner)
    const predicate = and(
      mcpOwnerPredicate(table, input.owner),
      mcpServerPredicate(table, input.server),
      eq(table.serverAuthRevision, input.server.authRevision),
      eq(table.issuer, binding.issuer),
      eq(table.resource, binding.resource),
    )
    const [identity] = yield* db
      .select({ id: sql<string>`uuidv7()` })
      .from(sql`(values (1)) as generated(value)`)
      .pipe(Effect.orDie)
    const reference = {
      organizationId: input.owner.organizationId,
      tenantId: input.owner.tenantId,
      id: identity!.id,
    }
    const information = Schema.decodeUnknownSync(Schema.JsonObject)(input.information)
    const metadata = mcpClientMetadata(yield* requireMcpBaseUrl)
    const mechanism = input.manual
      ? ("pre_registered" as const)
      : typeof information.client_id === "string" && information.client_id.startsWith("https://")
        ? ("cimd" as const)
        : ("dcr" as const)
    const values = {
      id: reference.id,
      organizationId: reference.organizationId,
      serverAuthRevision: input.server.authRevision,
      ...binding,
      redirectUri: metadata.redirect_uris[0]!,
      clientMetadata: Schema.decodeUnknownSync(Schema.JsonObject)(metadata),
      mechanism,
      credentials: {
        version: 1 as const,
        registration: reference,
        server: mcpReferenceFor(input.server),
        serverAuthRevision: input.server.authRevision,
        ...binding,
        clientInformation: information,
      },
      expiresAt:
        typeof information.client_secret_expires_at === "number" &&
        information.client_secret_expires_at > 0
          ? new Date(information.client_secret_expires_at * 1000)
          : null,
    }
    yield* db
      .transaction((transaction) =>
        Effect.gen(function* () {
          const definitionTable = mcpServerTable(input.server)
          const [definition] = yield* transaction
            .select({ revision: definitionTable.authRevision })
            .from(definitionTable)
            .where(mcpScopePredicate(definitionTable, input.server))
            .for("share")
          if (!definition || definition.revision !== input.server.authRevision)
            return yield* new McpChanged()
          yield* transaction
            .insert(table)
            .values({
              ...values,
              ...mcpOwnerValues(input.owner),
              ...mcpServerValues(table, input.server),
            })
            .onConflictDoNothing()
        }),
      )
      .pipe(Effect.orDie)
    const [winner] = yield* db
      .select({ id: table.id })
      .from(table)
      .where(predicate)
      .limit(1)
      .pipe(Effect.orDie)
    if (!winner) return yield* new McpChanged()
    const selected = yield* mcpReadClient(db, { ...reference, id: winner.id })
    if (
      selected.redirectUri !== metadata.redirect_uris[0] ||
      (input.manual &&
        ["client_id", "client_secret", "token_endpoint_auth_method"].some(
          (key) => selected.clientInformation[key] !== information[key],
        ))
    )
      return yield* new McpInvalidConfiguration()
    return {
      reference: selected.registration,
      information: selected.clientInformation as StoredOAuthClientInformation,
    }
  })

  const discover = Effect.fnUntraced(function* (server: McpStoredServer) {
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
    yield* Effect.try({
      try: () => mcpDiscoveryBinding(discovery, server.endpointUrl),
      catch: () => new McpInvalidConfiguration(),
    })
    return { ...discovery, ...(challengedScope ? { challengedScope } : {}) }
  })
  const configureClient = Effect.fn("McpAuthorization.configureClient")(function* (input: {
    actor: McpActor
    reference: McpReference
    manualClient: McpManualClient
  }) {
    const server = yield* connections.getServer(input)
    if (server.authConfig.kind !== "oauth") return yield* new McpInvalidConfiguration()
    const discovery = yield* discover(server)
    yield* saveRegistration({
      owner: server,
      server,
      discovery,
      information: mcpManualClientInformation(input.manualClient, discovery.authorizationServerUrl),
      manual: true,
    })
  })
  const start = Effect.fn("McpAuthorization.start")(function* (input: McpAuthorizeInput) {
    const baseUrl = yield* requireMcpBaseUrl
    if (
      !input.actor.interactive ||
      input.actor.apiKey ||
      (input.actor.organizationUserId === null && input.actor.tenantUserId === null)
    )
      return yield* new McpForbidden()
    const { connection, server } = yield* connections.getConnection(input)
    if (server.authConfig.kind !== "oauth" || !server.enabled)
      return yield* new McpInvalidConfiguration()
    if (!mcpDefinitionAllowed(yield* connections.policy(input.actor.organizationId), server))
      return yield* new McpForbidden()
    const discovery = yield* discover(server)
    const table = mcpAttemptTable(connection)
    const [identity] = yield* db
      .select({ id: sql<string>`uuidv7()` })
      .from(sql`(values (1)) as generated(value)`)
      .pipe(Effect.orDie)
    const reference = {
      organizationId: connection.organizationId,
      tenantId: connection.tenantId,
      id: identity!.id,
    }
    const state = `${Buffer.from(JSON.stringify(reference)).toString("base64url")}.${randomBytes(32).toString("base64url")}`
    const payload: McpAttemptEnvelope = {
      version: 1,
      attempt: reference,
      connection: mcpReferenceFor(input.reference),
      actor: input.actor,
      expectedGeneration: connection.authGeneration,
      serverAuthRevision: server.authRevision,
      state,
      verifier: null,
      discovery: Schema.decodeUnknownSync(Schema.JsonObject)(discovery),
      clientInformation: null,
      registration: null,
      authorizationUrl: null,
      pendingCredential: null,
    }
    const values = {
      id: reference.id,
      organizationId: reference.organizationId,
      connectionId: connection.id,
      actor: input.actor,
      stateHash: mcpHashSecret(state),
      expectedGeneration: connection.authGeneration,
      serverAuthRevision: server.authRevision,
      payload,
      expiresAt: new Date((yield* Clock.currentTimeMillis) + MCP_ATTEMPT_LIFETIME_MS),
    }
    yield* db
      .insert(table)
      .values({
        ...values,
        ...(reference.tenantId === null ? {} : { tenantId: reference.tenantId }),
      })
      .pipe(Effect.orDie)
    if (input.manualClient) {
      const saved = yield* saveRegistration({
        owner: connection,
        server,
        discovery,
        information: mcpManualClientInformation(
          input.manualClient,
          discovery.authorizationServerUrl,
        ),
        manual: true,
      })
      payload.registration = saved.reference
      payload.clientInformation = Schema.decodeUnknownSync(Schema.JsonObject)(saved.information)
    } else {
      if (connection.oauthClientId) {
        const current = yield* mcpReadClient(db, {
          organizationId: connection.organizationId,
          tenantId: connection.oauthClientTenantId,
          id: connection.oauthClientId,
        }).pipe(Effect.catchTag("McpAuthorizationRequired", () => Effect.succeed(null)))
        if (
          current &&
          current.serverAuthRevision === server.authRevision &&
          current.issuer === discovery.authorizationServerUrl &&
          current.resource === discovery.resourceMetadata!.resource &&
          current.redirectUri === mcpClientMetadata(baseUrl).redirect_uris[0]
        ) {
          payload.registration = current.registration
          payload.clientInformation = current.clientInformation
        }
      }
      if (!payload.registration) {
        const clientTable = mcpClientTable(server)
        const [registered] = yield* db
          .select({ id: clientTable.id })
          .from(clientTable)
          .where(
            and(
              mcpOwnerPredicate(clientTable, server),
              mcpServerPredicate(clientTable, server),
              eq(clientTable.serverAuthRevision, server.authRevision),
              eq(clientTable.issuer, discovery.authorizationServerUrl),
              eq(clientTable.resource, discovery.resourceMetadata!.resource),
            ),
          )
          .limit(1)
          .pipe(Effect.orDie)
        if (registered) {
          const client = yield* mcpReadClient(db, {
            organizationId: server.organizationId,
            tenantId: server.tenantId,
            id: registered.id,
          })
          if (client.redirectUri !== mcpClientMetadata(baseUrl).redirect_uris[0])
            return yield* new McpInvalidConfiguration()
          payload.registration = client.registration
          payload.clientInformation = client.clientInformation
        } else if (server.authConfig.registration === "pre_registered")
          return yield* new McpAuthorizationRequired()
      }
    }
    const provider = mcpAttemptProvider({
      payload,
      baseUrl,
      serverUrl: server.endpointUrl,
      authConfig: server.authConfig,
      now: () => Effect.runPromise(Clock.currentTimeMillis),
      persist: () => Effect.runPromise(persistAttempt(payload)),
      saveClient: (information) =>
        Effect.runPromise(saveRegistration({ owner: connection, server, discovery, information })),
    })
    const scopes = [
      ...new Set([
        ...(discovery.challengedScope?.split(/\s+/).filter(Boolean) ??
          discovery.resourceMetadata?.scopes_supported ??
          []),
        ...server.authConfig.requestedScopes,
      ]),
    ].join(" ")
    const result = yield* Effect.tryPromise({
      try: () =>
        mcpRunAuthorization({
          provider,
          dispatcher,
          serverUrl: server.endpointUrl,
          scope: scopes || undefined,
        }),
      catch: () => new McpAuthorizationRequired(),
    })
    if (result !== "REDIRECT" || !payload.authorizationUrl)
      return yield* new McpAuthorizationRequired()
    yield* db
      .update(table)
      .set({ status: "authorizing", payload })
      .where(mcpScopePredicate(table, reference))
      .pipe(Effect.orDie)
    const popup = new URL("/api/mcp/oauth/connect", baseUrl)
    popup.searchParams.set("attempt", Buffer.from(JSON.stringify(reference)).toString("base64url"))
    return { attempt: reference, popupUrl: popup.href }
  })

  const readAuthorizedAttempt = Effect.fnUntraced(function* (input: McpAttemptInput) {
    if (input.reference.organizationId !== input.actor.organizationId)
      return yield* new McpNotFound()
    const attempt = yield* mcpReadAttempt(db, input.reference)
    if (
      !attempt ||
      !mcpActorMatches(attempt.actor, input.actor) ||
      attempt.expiresAt.getTime() <= (yield* Clock.currentTimeMillis)
    )
      return yield* new McpNotFound()
    yield* connections.getConnection({
      actor: input.actor,
      reference: { ...input.reference, id: attempt.connectionId },
    })
    return attempt
  })
  const bindBrowser = Effect.fn("McpAuthorization.bindBrowser")(function* (
    input: McpAttemptInput & { challenge: string },
  ) {
    const attempt = yield* readAuthorizedAttempt(input)
    if (attempt.status !== "authorizing" || !/^[\w-]{43}$/.test(input.challenge))
      return yield* new McpChanged()
    const table = mcpAttemptTable(input.reference)
    const updated = yield* db
      .update(table)
      .set({ browserBindingHash: mcpHashSecret(input.challenge) })
      .where(
        and(
          mcpScopePredicate(table, input.reference),
          isNull(table.browserBindingHash),
          eq(table.status, "authorizing"),
        ),
      )
      .returning({ id: table.id })
      .pipe(Effect.orDie)
    if (!updated.length) return yield* new McpChanged()
  })
  const status = Effect.fn("McpAuthorization.status")(function* (input: McpAttemptInput) {
    return { status: (yield* readAuthorizedAttempt(input)).status }
  })
  const browserRedirect = Effect.fn("McpAuthorization.browserRedirect")(function* (input: {
    reference: McpReference
    browserBinding: string
  }) {
    const attempt = yield* mcpReadAttempt(db, input.reference)
    if (
      !attempt?.payload?.authorizationUrl ||
      attempt.status !== "authorizing" ||
      attempt.expiresAt.getTime() <= (yield* Clock.currentTimeMillis) ||
      attempt.browserBindingHash !== mcpHashSecret(input.browserBinding)
    )
      return yield* new McpAuthorizationRequired()
    const { connection, server } = yield* connections.getConnection({
      actor: attempt.actor,
      reference: attempt.payload.connection,
    })
    if (
      connection.authGeneration !== attempt.expectedGeneration ||
      server.authRevision !== attempt.serverAuthRevision
    )
      return yield* new McpChanged()
    return attempt.payload.authorizationUrl
  })
  const callback = Effect.fn("McpAuthorization.callback")(function* (input: {
    params: URLSearchParams
    browserBinding: string
  }) {
    const baseUrl = yield* requireMcpBaseUrl
    const state = input.params.get("state") ?? ""
    const reference = mcpAttemptLocator(state)
    if (!reference) return yield* new McpNotFound()
    const attempt = yield* mcpReadAttempt(db, reference)
    if (
      !attempt?.payload ||
      attempt.status !== "authorizing" ||
      attempt.expiresAt.getTime() <= (yield* Clock.currentTimeMillis) ||
      attempt.stateHash !== mcpHashSecret(state) ||
      !attempt.browserBindingHash ||
      attempt.browserBindingHash !== mcpHashSecret(input.browserBinding)
    )
      return yield* new McpAuthorizationRequired()
    const { connection, server } = yield* connections.getConnection({
      actor: attempt.actor,
      reference: attempt.payload.connection,
    })
    if (
      connection.authGeneration !== attempt.expectedGeneration ||
      server.authRevision !== attempt.serverAuthRevision ||
      server.authConfig.kind !== "oauth"
    )
      return yield* new McpChanged()
    const discovery = attempt.payload.discovery as unknown as OAuthDiscoveryState
    yield* Effect.try({
      try: () =>
        validateAuthorizationResponseIssuer({
          expectedIssuer: discovery.authorizationServerUrl,
          issParameterSupported:
            discovery.authorizationServerMetadata
              ?.authorization_response_iss_parameter_supported === true,
          iss: input.params.get("iss") ?? undefined,
        }),
      catch: () => new McpAuthorizationRequired(),
    })
    if (input.params.has("error") || !input.params.get("code"))
      return yield* new McpAuthorizationRequired()
    const table = mcpAttemptTable(reference)
    const claimed = yield* db
      .update(table)
      .set({ status: "exchanging" })
      .where(
        and(
          mcpScopePredicate(table, reference),
          eq(table.status, "authorizing"),
          gt(table.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: table.id })
      .pipe(Effect.orDie)
    if (!claimed.length) return yield* new McpChanged()
    const payload = attempt.payload
    const provider = mcpAttemptProvider({
      payload,
      baseUrl,
      serverUrl: server.endpointUrl,
      authConfig: server.authConfig,
      now: () => Effect.runPromise(Clock.currentTimeMillis),
      persist: () => Effect.runPromise(persistAttempt(payload)),
      saveClient: () => Promise.reject(new Error("Callback registration is forbidden")),
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
    }).pipe(
      Effect.catch((error) =>
        db
          .update(table)
          .set({ status: "failed", failureCode: "authorization_failed", payload: null })
          .where(mcpScopePredicate(table, reference))
          .pipe(Effect.orDie, Effect.andThen(Effect.fail(error))),
      ),
    )
    if (!payload.pendingCredential) return yield* new McpAuthorizationRequired()
    yield* db
      .update(table)
      .set({ status: "awaiting_completion", payload })
      .where(and(mcpScopePredicate(table, reference), eq(table.status, "exchanging")))
      .pipe(Effect.orDie)
    return reference
  })
  const complete = Effect.fn("McpAuthorization.complete")(function* (input: McpAttemptInput) {
    const attempt = yield* readAuthorizedAttempt(input)
    if (!attempt.payload?.pendingCredential || attempt.status !== "awaiting_completion")
      return yield* new McpAuthorizationRequired()
    const { connection, server } = yield* connections.getConnection({
      actor: input.actor,
      reference: attempt.payload.connection,
    })
    if (
      connection.authGeneration !== attempt.expectedGeneration ||
      server.authRevision !== attempt.serverAuthRevision
    )
      return yield* new McpChanged()
    const credential = attempt.payload.pendingCredential
    if (credential.kind !== "oauth") return yield* new McpAuthorizationRequired()
    const generation = crypto.randomUUID()
    const envelope: McpCredentialEnvelope = {
      version: 1,
      owner: mcpOwnerFor(connection),
      connection: attempt.payload.connection,
      server: mcpReferenceFor(server),
      serverAuthRevision: server.authRevision,
      authGeneration: generation,
      tokenRevision: 0,
      credential,
    }
    const connectionTable = mcpConnectionTable(connection)
    const attemptTable = mcpAttemptTable(input.reference)
    yield* db
      .transaction((transaction) =>
        Effect.gen(function* () {
          const definitionTable = mcpServerTable(server)
          const [definition] = yield* transaction
            .select({ revision: definitionTable.authRevision })
            .from(definitionTable)
            .where(mcpScopePredicate(definitionTable, server))
            .for("share")
          if (!definition || definition.revision !== attempt.serverAuthRevision)
            return yield* new McpChanged()
          const activeRegistration = yield* mcpReadClient(
            transaction,
            credential.clientRegistration,
          )
          if (activeRegistration.serverAuthRevision !== definition.revision)
            return yield* new McpChanged()
          if (!mcpDefinitionAllowed(yield* connections.policy(input.actor.organizationId), server))
            return yield* new McpForbidden()
          const claimed = yield* transaction
            .update(attemptTable)
            .set({ status: "completed", payload: null })
            .where(
              and(
                mcpScopePredicate(attemptTable, input.reference),
                eq(attemptTable.status, "awaiting_completion"),
                gt(attemptTable.expiresAt, sql`now()`),
              ),
            )
            .returning({ id: attemptTable.id })
          if (!claimed.length) return yield* new McpChanged()
          const values = {
            credentials: envelope,
            ...mcpClientValues(connectionTable, credential.clientRegistration),
            authGeneration: generation,
            tokenRevision: 0,
            authState: "connected" as const,
            authErrorCode: null,
            serverAuthRevision: server.authRevision,
            grantedScopes: credential.grantedScopes,
            expiresAt: credential.expiresAt === null ? null : new Date(credential.expiresAt),
            refreshClaimId: null,
            refreshClaimExpiresAt: null,
          }
          const updated = yield* transaction
            .update(connectionTable)
            .set(values)
            .where(
              and(
                mcpScopePredicate(connectionTable, connection),
                eq(connectionTable.authGeneration, attempt.expectedGeneration),
              ),
            )
            .returning({ id: connectionTable.id })
          if (!updated.length) return yield* new McpChanged()
        }),
      )
      .pipe(Effect.catchTag(["EffectDrizzleQueryError", "SqlError"], Effect.die))
  })

  const refresh = Effect.fnUntraced(function* (
    input: McpRuntimeCredentialInput,
    connection: McpStoredConnection,
    server: McpStoredServer,
    envelope: McpCredentialEnvelope,
  ) {
    if (envelope.credential.kind !== "oauth") return yield* new McpAuthorizationRequired()
    const credential = envelope.credential
    const table = mcpConnectionTable(connection)
    if (!credential.tokens.refresh_token) {
      yield* db
        .update(table)
        .set({ authState: "reauthorization_required", authErrorCode: "refresh_token_missing" })
        .where(
          and(
            mcpScopePredicate(table, connection),
            eq(table.authGeneration, connection.authGeneration),
            eq(table.tokenRevision, connection.tokenRevision),
            eq(table.authState, "connected"),
          ),
        )
        .pipe(Effect.orDie)
      return yield* new McpAuthorizationRequired()
    }
    if (connection.refreshClaimId) {
      if (
        connection.refreshClaimExpiresAt &&
        connection.refreshClaimExpiresAt.getTime() <= (yield* Clock.currentTimeMillis)
      ) {
        yield* db
          .update(table)
          .set({ authState: "refresh_uncertain", authErrorCode: "refresh_uncertain" })
          .where(
            and(
              mcpScopePredicate(table, connection),
              eq(table.authGeneration, connection.authGeneration),
              eq(table.tokenRevision, connection.tokenRevision),
              eq(table.refreshClaimId, connection.refreshClaimId),
            ),
          )
          .pipe(Effect.orDie)
        return yield* new McpAuthorizationRequired()
      }
      return null
    }
    const registration = yield* mcpReadClient(db, credential.clientRegistration)
    if (
      registration.issuer !== credential.issuer ||
      registration.resource !== credential.resource ||
      registration.serverAuthRevision !== server.authRevision
    )
      return yield* new McpAuthorizationRequired()
    const claimId = crypto.randomUUID()
    const claimed = yield* db
      .update(table)
      .set({
        refreshClaimId: claimId,
        refreshClaimExpiresAt: sql`now() + interval '30 seconds'`,
      })
      .where(
        and(
          mcpScopePredicate(table, connection),
          eq(table.authGeneration, connection.authGeneration),
          eq(table.tokenRevision, connection.tokenRevision),
          isNull(table.refreshClaimId),
          eq(table.authState, "connected"),
        ),
      )
      .returning({ id: table.id })
      .pipe(Effect.orDie)
    if (!claimed.length) {
      yield* Effect.logDebug("MCP refresh contention", { connectionId: connection.id })
      return null
    }
    const claim = and(
      mcpScopePredicate(table, connection),
      eq(table.authGeneration, connection.authGeneration),
      eq(table.tokenRevision, connection.tokenRevision),
      eq(table.refreshClaimId, claimId),
      eq(table.authState, "connected"),
      gt(table.refreshClaimExpiresAt, sql`now()`),
    )
    const discovery = credential.discovery as unknown as OAuthDiscoveryState
    const tokens = yield* Effect.tryPromise({
      try: () =>
        refreshAuthorization(credential.issuer, {
          ...(discovery.authorizationServerMetadata
            ? { metadata: discovery.authorizationServerMetadata }
            : {}),
          clientInformation: registration.clientInformation as OAuthClientInformationMixed,
          refreshToken: credential.tokens.refresh_token!,
          resource: credential.resource,
          fetchFn: guardedAuthFetch,
        }),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) => {
        const code = error instanceof OAuthError ? error.code : undefined
        const definite = typeof code === "string"
        const state =
          code === "invalid_grant"
            ? ("reauthorization_required" as const)
            : definite
              ? ("connected" as const)
              : ("refresh_uncertain" as const)
        const category = state === "connected" ? "transient" : state
        return db
          .update(table)
          .set({
            authState: state,
            authErrorCode:
              code === "invalid_grant"
                ? "invalid_grant"
                : definite
                  ? "refresh_failed"
                  : "refresh_uncertain",
            refreshClaimId: null,
            refreshClaimExpiresAt: null,
          })
          .where(claim)
          .pipe(
            Effect.orDie,
            Effect.tap(() =>
              Effect.logWarning("MCP credential refresh failed", {
                connectionId: connection.id,
                category,
              }),
            ),
            Effect.andThen(
              Effect.fail(
                definite && code !== "invalid_grant"
                  ? new McpUnavailable()
                  : new McpAuthorizationRequired(),
              ),
            ),
          )
      }),
    )
    yield* connections.getConnection({
      actor: input.actor,
      reference: input.reference,
      use: true,
    })
    const refreshed = mcpOAuthCredential({
      tokens: { ...tokens, issuer: credential.issuer },
      discovery,
      registration: credential.clientRegistration,
      serverUrl: server.endpointUrl,
      now: yield* Clock.currentTimeMillis,
      previous: credential,
    })
    const updated = yield* db
      .update(table)
      .set({
        credentials: {
          ...envelope,
          tokenRevision: connection.tokenRevision + 1,
          credential: refreshed,
        },
        tokenRevision: connection.tokenRevision + 1,
        grantedScopes: refreshed.grantedScopes,
        expiresAt: refreshed.expiresAt === null ? null : new Date(refreshed.expiresAt),
        refreshClaimId: null,
        refreshClaimExpiresAt: null,
        authErrorCode: null,
      })
      .where(claim)
      .returning({ id: table.id })
      .pipe(Effect.orDie)
    if (!updated.length) return yield* new McpChanged()
    return refreshed
  })
  const getCredential = Effect.fn("McpAuthorization.getCredential")(function* (
    input: McpRuntimeCredentialInput,
  ) {
    const deadline = (yield* Clock.currentTimeMillis) + MCP_REFRESH_LEASE_MS
    while ((yield* Clock.currentTimeMillis) < deadline) {
      const { connection, server } = yield* connections.getConnection({
        actor: input.actor,
        reference: input.reference,
        use: true,
      })
      if (
        input.expectedGeneration !== undefined &&
        connection.authGeneration !== input.expectedGeneration
      )
        return yield* new McpChanged()
      if (connection.authState !== "connected") return yield* new McpAuthorizationRequired()
      if (server.authConfig.kind === "none") return Redacted.make<McpCredential | null>(null)
      const envelope = mcpDecodeCredential(connection)
      if (!envelope) return yield* new McpAuthorizationRequired()
      if (envelope.credential.kind === "static_headers")
        return Redacted.make<McpCredential | null>(envelope.credential)
      const credential = envelope.credential
      const registration = yield* mcpReadClient(db, credential.clientRegistration)
      if (registration.serverAuthRevision !== server.authRevision)
        return yield* new McpAuthorizationRequired()
      if (
        !connection.refreshClaimId &&
        (input.rejectedToken === undefined ||
          input.rejectedToken !== credential.tokens.access_token) &&
        (credential.expiresAt === null ||
          credential.expiresAt > (yield* Clock.currentTimeMillis) + MCP_REFRESH_MARGIN_MS)
      )
        return Redacted.make<McpCredential | null>(credential)
      const result = yield* refresh(input, connection, server, envelope)
      if (result) {
        yield* connections.getConnection({
          actor: input.actor,
          reference: input.reference,
          use: true,
        })
        return Redacted.make<McpCredential | null>(result)
      }
      yield* Effect.sleep("100 millis")
    }
    return yield* new McpUnavailable()
  })
  return {
    start,
    bindBrowser,
    browserRedirect,
    status,
    callback,
    complete,
    getCredential,
    configureClient,
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
