import { fetch as fixtureFetch, Agent } from "undici/index.js"
import { createServer } from "node:http"
import { once } from "node:events"

export async function startMcpFixture() {
  const state = {
    oauth: false,
    issuer: "https://fixture.example",
    resourceMetadataChallenge: true,
    cimd: false,
    sse: false,
    listPages: 2,
    extraTools: [] as { name: string; inputSchema: Record<string, unknown> }[],
    rejectedListToken: "",
    lostToolResponse: false,
    toolGate: null as (() => Promise<void>) | null,
    protocol: "2026-07-28",
    registrations: 0,
    refreshes: 0,
    calls: 0,
    regionHeader: undefined as string | string[] | undefined,
    refreshError: "",
    gatewayError: false,
    authorizationError: "",
    disconnectResponse: false,
    tokenGate: null as (() => Promise<void>) | null,
    tokenRequests: 0,
    authorizationToken: "access-0",
    authorizationRefreshToken: "rotating-refresh" as string | null,
    requests: [] as string[],
  }
  const dispatcher = new Agent()
  const server = createServer((request, response) => {
    void (async () => {
      const chunks = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const text = Buffer.concat(chunks).toString()
      const path = new URL(request.url!, "http://fixture").pathname
      response.setHeader("Content-Type", "application/json")
      const json = (body: unknown) => response.end(JSON.stringify(body))
      if (path === "/metadata/resource" || path.includes("oauth-protected-resource"))
        return json({
          resource: "https://fixture.example/mcp",
          authorization_servers: [state.issuer],
          scopes_supported: ["read", "admin"],
        })
      if (path.includes(".well-known"))
        return json({
          issuer: state.issuer,
          authorization_endpoint: "https://fixture.example/authorize",
          token_endpoint: "https://fixture.example/token",
          registration_endpoint: "https://fixture.example/register",
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
          authorization_response_iss_parameter_supported: true,
          client_id_metadata_document_supported: state.cimd,
        })
      if (path === "/register") {
        state.registrations++
        return json({ ...JSON.parse(text), client_id: `registered-${state.registrations}` })
      }
      if (path === "/token") {
        const fields = new URLSearchParams(text)
        state.tokenRequests++
        if (state.authorizationError && fields.get("grant_type") === "authorization_code") {
          response.statusCode = 400
          return json({
            error: state.authorizationError,
            error_description: "private-provider-description",
          })
        }
        if (fields.get("grant_type") === "refresh_token") {
          state.refreshes++
          if (state.gatewayError) {
            response.statusCode = 502
            return response.end("Gateway lost the redeemed token response")
          }
          if (state.disconnectResponse) return response.destroy()
          if (state.refreshError) {
            response.statusCode = state.refreshError === "too_many_requests" ? 429 : 400
            return json({ error: state.refreshError })
          }
        }
        await state.tokenGate?.()
        return json({
          access_token:
            fields.get("grant_type") === "authorization_code"
              ? state.authorizationToken
              : `access-${state.refreshes}`,
          token_type: "Bearer",
          ...(fields.get("grant_type") === "authorization_code" && state.authorizationRefreshToken
            ? { refresh_token: state.authorizationRefreshToken }
            : {}),
          expires_in: 3600,
          scope: "read",
        })
      }
      if (path === "/mcp") {
        if (state.oauth && !request.headers.authorization) {
          response.statusCode = 401
          response.setHeader(
            "WWW-Authenticate",
            state.resourceMetadataChallenge
              ? 'Bearer resource_metadata="https://fixture.example/metadata/resource", scope="read admin"'
              : 'Bearer scope="read admin"',
          )
          return response.end()
        }
        const body = JSON.parse(text) as {
          id: string
          method: string
          params?: { cursor?: string; arguments?: unknown }
        }
        state.requests.push(body.method)
        if (
          body.method === "tools/list" &&
          request.headers.authorization === `Bearer ${state.rejectedListToken}`
        ) {
          response.statusCode = 401
          return response.end()
        }
        let result: unknown
        if (body.method === "server/discover")
          result = {
            supportedVersions: [state.protocol],
            serverInfo: { name: "Fixture", version: "1" },
            capabilities: { tools: {} },
          }
        else if (body.method === "tools/list") {
          const page = Number(body.params?.cursor ?? 1)
          result =
            page < state.listPages
              ? {
                  tools: [],
                  nextCursor: String(page + 1),
                }
              : {
                  tools: [
                    {
                      name: "lookup",
                      title: "Look up",
                      inputSchema: {
                        type: "object",
                        properties: { region: { type: "string", "x-mcp-header": "Region" } },
                        required: ["region"],
                        additionalProperties: false,
                      },
                      outputSchema: {
                        type: "object",
                        properties: { ok: { type: "boolean" } },
                        required: ["ok"],
                      },
                    },
                    ...state.extraTools,
                  ],
                }
        } else if (body.method === "tools/call") {
          state.calls++
          state.regionHeader = request.headers["mcp-param-region"]
          if (state.lostToolResponse) return response.destroy()
          await state.toolGate?.()
          result = {
            content: [{ type: "text", text: "done" }],
            structuredContent: { ok: true },
          }
        } else {
          response.statusCode = 400
          return json({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32601, message: "Unsupported" },
          })
        }
        const envelope = JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            resultType: "complete",
            ttlMs: 0,
            cacheScope: "private",
            ...(result as Record<string, unknown>),
          },
        })
        if (state.sse) {
          response.setHeader("Content-Type", "text/event-stream")
          return response.end(`event: message\ndata: ${envelope}\n\n`)
        }
        return response.end(envelope)
      }
      response.statusCode = 404
      return response.end()
    })().catch(() => response.destroy())
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Fixture address missing")
  return {
    origin: `http://127.0.0.1:${address.port}`,
    state,
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const source = new URL(input instanceof Request ? input.url : input)
      source.protocol = "http:"
      source.host = `127.0.0.1:${address.port}`
      const response = await fixtureFetch(source, { ...init, dispatcher } as Parameters<
        typeof fixtureFetch
      >[1])
      return response as unknown as Response
    },
    close: async () => {
      await dispatcher.close()
      return new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}
