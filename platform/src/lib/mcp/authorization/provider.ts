import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client"
import { Schema } from "effect"
import type { Agent } from "undici"
import { APP_NAME } from "@/lib/constants"
import {
  McpOAuthTokensSchema,
  MCP_AUTH_TIMEOUT_MS,
  type McpAttemptEnvelope,
  type McpAuthConfig,
  type McpCredential,
} from "../schemas.ts"
import { mcpGuardedFetch, mcpUrlIsPublic } from "../network.server.ts"

export function mcpClientMetadata(baseUrl: string) {
  return {
    client_name: APP_NAME,
    client_uri: baseUrl,
    redirect_uris: [new URL("/api/mcp/oauth/callback", baseUrl).href],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }
}

export function mcpDiscoveryBinding(discovery: OAuthDiscoveryState, serverUrl: string) {
  const issuer = discovery.authorizationServerMetadata?.issuer
  const resource = discovery.resourceMetadata?.resource
  if (
    !issuer ||
    issuer !== discovery.authorizationServerUrl ||
    !resource ||
    !discovery.resourceMetadata?.authorization_servers?.includes(issuer)
  )
    throw new TypeError("MCP OAuth discovery is incomplete")
  const endpoint = new URL(serverUrl)
  const resourceUrl = new URL(resource)
  if (
    !mcpUrlIsPublic(new URL(issuer)) ||
    !mcpUrlIsPublic(resourceUrl) ||
    resourceUrl.origin !== endpoint.origin ||
    !(
      endpoint.pathname === resourceUrl.pathname ||
      endpoint.pathname.startsWith(
        resourceUrl.pathname.endsWith("/") ? resourceUrl.pathname : `${resourceUrl.pathname}/`,
      )
    ) ||
    resourceUrl.search !== endpoint.search
  )
    throw new TypeError("MCP OAuth resource binding was refused")
  return { issuer, resource }
}

export function mcpOAuthCredential(input: {
  tokens: StoredOAuthTokens
  discovery: OAuthDiscoveryState
  clientInformation: Schema.JsonObject
  serverUrl: string
  now: number
  previous?: Extract<McpCredential, { kind: "oauth" }> | undefined
}): Extract<McpCredential, { kind: "oauth" }> {
  const { issuer } = mcpDiscoveryBinding(input.discovery, input.serverUrl)
  if (input.tokens.issuer !== issuer || input.tokens.token_type.toLowerCase() !== "bearer")
    throw new TypeError("MCP OAuth token binding was refused")
  const refreshToken = input.tokens.refresh_token ?? input.previous?.tokens.refresh_token
  const scope = input.tokens.scope ?? input.previous?.tokens.scope
  const tokens = Schema.decodeUnknownSync(McpOAuthTokensSchema)({
    ...input.tokens,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    ...(scope ? { scope } : {}),
  })
  return {
    kind: "oauth",
    clientInformation: input.clientInformation,
    tokens,
    expiresAt: tokens.expires_in === undefined ? null : input.now + tokens.expires_in * 1000,
    discovery: Schema.decodeUnknownSync(Schema.JsonObject)(input.discovery),
  }
}

export function mcpAttemptProvider(input: {
  payload: McpAttemptEnvelope
  baseUrl: string
  serverUrl: string
  authConfig: Extract<McpAuthConfig, { kind: "oauth" }>
  now: () => Promise<number>
  persist: () => Promise<void>
}): OAuthClientProvider {
  const metadata = mcpClientMetadata(input.baseUrl)
  return {
    redirectUrl: metadata.redirect_uris[0],
    ...(new URL(input.baseUrl).protocol === "https:"
      ? { clientMetadataUrl: new URL("/api/mcp/oauth/client-metadata.json", input.baseUrl).href }
      : {}),
    clientMetadata: metadata,
    state: () => input.payload.state,
    clientInformation: (context) => {
      const information = input.payload.clientInformation as StoredOAuthClientInformation | null
      return information && (!context || information.issuer === context.issuer)
        ? information
        : undefined
    },
    async saveClientInformation(information) {
      input.payload.clientInformation = Schema.decodeUnknownSync(Schema.JsonObject)(information)
      await input.persist()
    },
    tokens: () => undefined,
    async saveTokens(tokens) {
      if (!input.payload.discovery || !input.payload.clientInformation)
        throw new TypeError("MCP authorization is incomplete")
      input.payload.pendingCredential = mcpOAuthCredential({
        tokens,
        discovery: input.payload.discovery as unknown as OAuthDiscoveryState,
        clientInformation: input.payload.clientInformation,
        serverUrl: input.serverUrl,
        now: await input.now(),
      })
      await input.persist()
    },
    async redirectToAuthorization(url) {
      if (!mcpUrlIsPublic(url)) throw new TypeError("MCP authorization endpoint was refused")
      if (input.authConfig.profile === "google") {
        url.searchParams.set("access_type", "offline")
        url.searchParams.set("include_granted_scopes", "true")
        // Fresh consent may select another account, so obtain its own offline grant.
        // https://developers.google.com/identity/protocols/oauth2/web-server#offline
        url.searchParams.set("prompt", "consent")
      }
      input.payload.authorizationUrl = url.href
      await input.persist()
    },
    async saveCodeVerifier(verifier) {
      input.payload.verifier = verifier
      await input.persist()
    },
    codeVerifier: () => {
      if (!input.payload.verifier) throw new TypeError("MCP verifier is missing")
      return input.payload.verifier
    },
    async saveDiscoveryState(discovery) {
      mcpDiscoveryBinding(discovery, input.serverUrl)
      input.payload.discovery = Schema.decodeUnknownSync(Schema.JsonObject)(discovery)
      await input.persist()
    },
    discoveryState: () =>
      (input.payload.discovery as unknown as OAuthDiscoveryState | undefined) ?? undefined,
    async invalidateCredentials(scope) {
      if (scope === "client" || scope === "all") {
        input.payload.clientInformation = null
      }
      if (scope === "tokens" || scope === "all") input.payload.pendingCredential = null
      if (scope === "verifier" || scope === "all") input.payload.verifier = null
      if (scope === "discovery" || scope === "all") input.payload.discovery = null
      await input.persist()
    },
  }
}

export async function mcpRunAuthorization(input: {
  provider: OAuthClientProvider
  dispatcher: Agent
  serverUrl: string
  scope?: string | undefined
  callback?: URLSearchParams | undefined
}) {
  return auth(input.provider, {
    serverUrl: input.serverUrl,
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.callback
      ? {
          ...(input.callback.get("code") ? { authorizationCode: input.callback.get("code")! } : {}),
          ...(input.callback.has("iss") ? { iss: input.callback.get("iss")! } : {}),
        }
      : { forceReauthorization: true }),
    fetchFn: (url, init) =>
      mcpGuardedFetch(input.dispatcher, url, {
        ...init,
        signal: AbortSignal.any([
          ...(init?.signal ? [init.signal] : []),
          AbortSignal.timeout(MCP_AUTH_TIMEOUT_MS),
        ]),
      }),
  })
}
