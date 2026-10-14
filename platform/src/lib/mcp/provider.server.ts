import {
  auth,
  checkResourceAllowed,
  OAuthErrorCode,
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
} from "./schemas.ts"
import { mcpGuardedFetch, mcpUrlIsPublic } from "./network.server.ts"

export async function mcpAuthorizationFetch(
  dispatcher: Agent,
  url: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const response = await mcpGuardedFetch(dispatcher, url, {
    ...init,
    signal: AbortSignal.any([
      ...(init?.signal ? [init.signal] : []),
      AbortSignal.timeout(MCP_AUTH_TIMEOUT_MS),
    ]),
  })
  if ((init?.method ?? (url instanceof Request ? url.method : "GET")).toUpperCase() !== "POST")
    return response
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null)
  if (response.ok && !(body && typeof body === "object" && "error" in body)) return response
  // Gateway errors can follow token redemption. Strip descriptions before SDK logging.
  // https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/src/client/auth.ts
  const error = Schema.decodeUnknownResult(
    Schema.Struct({ error: Schema.Literals(Object.values(OAuthErrorCode)) }),
  )(body)
  if (response.status >= 500 || error._tag === "Failure")
    throw new TypeError("MCP OAuth request outcome is uncertain")
  return Response.json({ error: error.success.error }, { status: response.status })
}

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
    !checkResourceAllowed({ requestedResource: endpoint, configuredResource: resourceUrl }) ||
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

function mcpAttemptProvider(input: {
  payload: McpAttemptEnvelope
  baseUrl: string
  serverUrl: string
  authConfig: Extract<McpAuthConfig, { kind: "oauth" }>
  now: () => Promise<number>
}): OAuthClientProvider {
  const metadata = mcpClientMetadata(input.baseUrl)
  return {
    redirectUrl: metadata.redirect_uris[0],
    ...(new URL(input.baseUrl).protocol === "https:"
      ? { clientMetadataUrl: new URL("/api/mcp/oauth/client-metadata.json", input.baseUrl).href }
      : {}),
    clientMetadata: metadata,
    state: () => input.payload.state,
    clientInformation: () =>
      (input.payload.clientInformation as StoredOAuthClientInformation | null) ?? undefined,
    saveClientInformation(information) {
      input.payload.clientInformation = Schema.decodeUnknownSync(Schema.JsonObject)(information)
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
    },
    redirectToAuthorization(url) {
      if (!mcpUrlIsPublic(url)) throw new TypeError("MCP authorization endpoint was refused")
      if (input.authConfig.profile === "google") {
        url.searchParams.set("access_type", "offline")
        url.searchParams.set("include_granted_scopes", "true")
        // Fresh consent may select another account, so obtain its own offline grant.
        // https://developers.google.com/identity/protocols/oauth2/web-server#offline
        url.searchParams.set("prompt", "consent")
      }
      input.payload.authorizationUrl = url.href
    },
    saveCodeVerifier(verifier) {
      input.payload.verifier = verifier
    },
    codeVerifier: () => {
      if (!input.payload.verifier) throw new TypeError("MCP verifier is missing")
      return input.payload.verifier
    },
    saveDiscoveryState(discovery) {
      mcpDiscoveryBinding(discovery, input.serverUrl)
      input.payload.discovery = Schema.decodeUnknownSync(Schema.JsonObject)(discovery)
    },
    discoveryState: () =>
      (input.payload.discovery as unknown as OAuthDiscoveryState | undefined) ?? undefined,
    invalidateCredentials(scope) {
      if (scope === "client" || scope === "all") {
        if (input.authConfig.client)
          throw new TypeError("MCP application credentials were rejected")
        input.payload.clientInformation = null
      }
      if (scope === "tokens" || scope === "all") input.payload.pendingCredential = null
      if (scope === "verifier" || scope === "all") input.payload.verifier = null
      if (scope === "discovery" || scope === "all") input.payload.discovery = null
    },
  }
}

export async function mcpRunAuthorization(
  input: Parameters<typeof mcpAttemptProvider>[0] & {
    dispatcher: Agent
    scope?: string | undefined
    callback?: URLSearchParams | undefined
  },
) {
  return auth(mcpAttemptProvider(input), {
    serverUrl: input.serverUrl,
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.callback
      ? {
          ...(input.callback.get("code") ? { authorizationCode: input.callback.get("code")! } : {}),
          ...(input.callback.has("iss") ? { iss: input.callback.get("iss")! } : {}),
        }
      : { forceReauthorization: true }),
    fetchFn: (url, init) => mcpAuthorizationFetch(input.dispatcher, url, init),
  })
}
