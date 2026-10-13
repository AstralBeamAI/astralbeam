import { fetch as fixtureFetch, Agent } from "undici"
import { createServer } from "node:http"
import { once } from "node:events"
import { mcpBoundedResponse } from "../network.server.ts"

export async function startMcpFixture() {
  const state = {
    oauth: false,
    cimd: false,
    sse: false,
    badOutput: false,
    duplicateTools: false,
    lostToolResponse: false,
    toolGate: null as (() => Promise<void>) | null,
    protocol: "2026-07-28",
    registrations: 0,
    refreshes: 0,
    calls: 0,
    refreshError: "",
    disconnectResponse: false,
    tokenGate: null as (() => Promise<void>) | null,
    tokenRequests: 0,
    authorizationToken: "access-0",
    authorizationRefreshToken: "rotating-refresh" as string | null,
    requests: [] as {
      method: string
      headers: Record<string, string | string[] | undefined>
      body: Record<string, unknown>
    }[],
  }
  const dispatcher = new Agent()
  const server = createServer((request, response) => {
    void (async () => {
      const chunks = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const text = Buffer.concat(chunks).toString()
      const path = new URL(request.url!, "http://fixture").pathname
      response.setHeader("Content-Type", "application/json")
      if (path.includes("oauth-protected-resource"))
        return response.end(
          JSON.stringify({
            resource: "https://fixture.example/mcp",
            authorization_servers: ["https://fixture.example"],
            scopes_supported: ["read"],
          }),
        )
      if (path.includes(".well-known"))
        return response.end(
          JSON.stringify({
            issuer: "https://fixture.example",
            authorization_endpoint: "https://fixture.example/authorize",
            token_endpoint: "https://fixture.example/token",
            registration_endpoint: "https://fixture.example/register",
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
            authorization_response_iss_parameter_supported: true,
            client_id_metadata_document_supported: state.cimd,
          }),
        )
      if (path === "/register") {
        state.registrations++
        return response.end(
          JSON.stringify({ ...JSON.parse(text), client_id: `registered-${state.registrations}` }),
        )
      }
      if (path === "/token") {
        const fields = new URLSearchParams(text)
        state.tokenRequests++
        if (fields.get("grant_type") === "refresh_token") {
          state.refreshes++
          if (state.disconnectResponse) return response.destroy()
          if (state.refreshError) {
            response.statusCode = 400
            return response.end(JSON.stringify({ error: state.refreshError }))
          }
        }
        await state.tokenGate?.()
        return response.end(
          JSON.stringify({
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
          }),
        )
      }
      if (path === "/mcp") {
        if (state.oauth && !request.headers.authorization) {
          response.statusCode = 401
          response.setHeader(
            "WWW-Authenticate",
            'Bearer resource_metadata="https://fixture.example/.well-known/oauth-protected-resource/mcp", scope="read"',
          )
          return response.end()
        }
        const body = JSON.parse(text) as {
          id: string
          method: string
          params?: { cursor?: string; arguments?: unknown }
        }
        state.requests.push({ method: body.method, headers: request.headers, body })
        let result: unknown
        if (body.method === "server/discover")
          result = {
            supportedVersions: [state.protocol],
            serverInfo: { name: "Fixture", version: "1" },
            capabilities: { tools: {} },
          }
        else if (body.method === "tools/list")
          result = body.params?.cursor
            ? {
                tools: state.duplicateTools
                  ? [{ name: "lookup", inputSchema: { type: "object" } }]
                  : [],
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
                ],
                nextCursor: "next-page",
              }
        else if (body.method === "tools/call") {
          state.calls++
          if (state.lostToolResponse) return response.destroy()
          await state.toolGate?.()
          result = {
            content: [{ type: "text", text: "done" }],
            structuredContent: { ok: state.badOutput ? "invalid" : true },
          }
        } else {
          response.statusCode = 400
          return response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              error: { code: -32601, message: "Unsupported" },
            }),
          )
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
      return mcpBoundedResponse(response as unknown as Response, 5 * 1024 * 1024)
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
