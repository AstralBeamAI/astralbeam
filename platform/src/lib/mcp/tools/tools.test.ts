import { Effect, Layer, Redacted, Scope } from "effect"
import { afterEach, describe, expect, test, vi } from "vitest"
const mcpFixtureFetch = vi.hoisted(() => ({ fetch: globalThis.fetch }))
vi.mock("../network.server.ts", async (original) => ({
  ...(await original<typeof import("../network.server.ts")>()),
  mcpGuardedFetch: (_dispatcher: unknown, input: string | URL | Request, init?: RequestInit) =>
    mcpFixtureFetch.fetch(input, init),
}))
import { McpTools, mcpToolAlias } from "./tools.ts"
import { McpConnections } from "../mcp.server.ts"
import { McpAuthorization } from "../authorization/authorization.ts"
import { startMcpFixture } from "../testing/fixture.ts"
import type { McpActor, McpAuthConfig, McpCredential, McpReference } from "../schemas.ts"
const mcpToolTestActor: McpActor = {
  organizationId: "019a0000-0000-7000-8000-000000000001",
  tenantId: null,
  tenantUserId: null,
  organizationUserId: "019a0000-0000-7000-8000-000000000002",
  apiKey: false,
  admin: true,
  interactive: true,
}
const mcpToolTestConnection = {
  ...mcpToolTestActor,
  id: "019a0000-0000-7000-8000-000000000003",
  name: "Account",
  enabled: true,
  authState: "connected",
  availability: "available",
}
const mcpToolTestServer = {
  ...mcpToolTestActor,
  id: "019a0000-0000-7000-8000-000000000004",
  endpointUrl: "https://fixture.example/mcp",
  authConfig: { kind: "none" },
}
let mcpToolFixture: Awaited<ReturnType<typeof startMcpFixture>>
afterEach(async () => {
  await mcpToolFixture?.close()
})
async function withMcpTools<A>(
  use: (tools: typeof McpTools.Service) => Effect.Effect<A, unknown, Scope.Scope>,
  getCredential: () => McpCredential | null = () => null,
  authConfig: McpAuthConfig = { kind: "none" },
  catalog = [mcpToolTestConnection],
) {
  mcpToolFixture = await startMcpFixture()
  mcpFixtureFetch.fetch = mcpToolFixture.fetch
  return Effect.runPromise(
    Effect.scoped(Effect.flatMap(McpTools, use)).pipe(
      Effect.provide(
        McpTools.layerNoDeps.pipe(
          Layer.provide([
            Layer.succeed(McpConnections, {
              catalog: () => Effect.succeed({ connections: catalog }),
              getConnection: ({ reference }: { reference: McpReference }) =>
                Effect.succeed({
                  connection: catalog.find((entry) => entry.id === reference.id),
                  server: {
                    ...mcpToolTestServer,
                    endpointUrl: `${mcpToolTestServer.endpointUrl}?connection=${reference.id}`,
                    authConfig,
                  },
                }),
            } as unknown as typeof McpConnections.Service),
            Layer.succeed(McpAuthorization, {
              getCredential: () => Effect.succeed(Redacted.make(getCredential())),
            } as unknown as typeof McpAuthorization.Service),
          ]),
        ),
      ),
    ),
  )
}
describe("request-oriented MCP tools", () => {
  test("omits a duplicate tool catalog without disrupting another connection", async () => {
    const healthy = { ...mcpToolTestConnection, id: "019a0000-0000-7000-8000-000000000005" }
    await withMcpTools(
      (tools) =>
        Effect.gen(function* () {
          const fetch = mcpToolFixture.fetch
          mcpFixtureFetch.fetch = (url, init) => {
            mcpToolFixture.state.duplicateTools =
              new URL(url instanceof Request ? url.url : url).searchParams.get("connection") ===
              mcpToolTestConnection.id
            return fetch(url, init)
          }
          const set = yield* tools.acquire(mcpToolTestActor)
          expect(set.unavailable).toEqual([mcpToolTestConnection.id])
          expect(set.tools.map((tool) => tool.name)).toEqual([mcpToolAlias(healthy.id, "lookup")])
          expect(set.presentation.map((tool) => tool.connectionId)).toEqual([healthy.id])
          yield* Effect.promise(() =>
            Promise.resolve(set.tools[0]!.execute!({ region: "eu" }, undefined)),
          )
          expect(mcpToolFixture.state.calls).toBe(1)
        }),
      undefined,
      undefined,
      [mcpToolTestConnection, healthy],
    )
  })
  test("dispatch rereads credentials after the SDK token hook", async () => {
    let reads = 0
    await withMcpTools(
      (tools) =>
        Effect.gen(function* () {
          const set = yield* tools.acquire(mcpToolTestActor)
          expect(mcpToolFixture.state.requests[0]!.headers.authorization).toBe(
            "Bearer replacement-token",
          )
          yield* Effect.promise(() =>
            Promise.resolve(set.tools[0]!.execute!({ region: "eu" }, undefined)),
          )
          const request = mcpToolFixture.state.requests.find((row) => row.method === "tools/call")!
          expect(request.headers.authorization).toBe("Bearer replacement-token")
        }),
      () => ({
        kind: "oauth",
        issuer: "https://fixture.example",
        resource: mcpToolTestServer.endpointUrl,
        clientRegistration: {
          organizationId: mcpToolTestActor.organizationId,
          tenantId: null,
          id: mcpToolTestServer.id,
        },
        tokens: {
          access_token: ++reads <= 2 ? "old-token" : "replacement-token",
          token_type: "Bearer",
        },
        expiresAt: null,
        grantedScopes: [],
        discovery: {},
      }),
      { kind: "oauth", registration: "automatic", profile: "standard", requestedScopes: [] },
    )
  })
  test.each([false, true])(
    "discovers paginated tools and executes with SDK metadata over SSE=%s",
    async (sse) => {
      await withMcpTools((tools) =>
        Effect.gen(function* () {
          mcpToolFixture.state.sse = sse
          const set = yield* tools.acquire(mcpToolTestActor)
          expect(set.unavailable).toEqual([])
          expect(set.tools).toHaveLength(1)
          const tool = set.tools[0]!
          expect(tool.name).toHaveLength(61)
          expect(tool.name).toBe(mcpToolAlias(mcpToolTestConnection.id, "lookup"))
          const schema = tool.inputSchema as {
            "~standard": { validate: (input: unknown) => unknown }
          }
          expect(schema["~standard"].validate({ region: 3 })).toHaveProperty("issues")
          expect(mcpToolFixture.state.calls).toBe(0)
          const result = yield* Effect.promise(() =>
            Promise.resolve(tool.execute!({ region: "eu" }, undefined) as unknown),
          )
          expect(result).toMatchObject({ structuredContent: { ok: true } })
          expect(mcpToolFixture.state.calls).toBe(1)
          const call = mcpToolFixture.state.requests.find(
            (request) => request.method === "tools/call",
          )!
          expect(call.headers["mcp-param-region"]).toBe("eu")
          expect(call.headers["mcp-protocol-version"]).toBe("2026-07-28")
          expect(
            mcpToolFixture.state.requests.some((request) => request.method === "initialize"),
          ).toBe(false)
        }),
      )
    },
  )
  test("rejects legacy protocol and invalid structured output without replaying tool calls", async () => {
    await withMcpTools((tools) =>
      Effect.gen(function* () {
        mcpToolFixture.state.protocol = "2025-11-25"
        expect((yield* tools.acquire(mcpToolTestActor)).unavailable).toEqual([
          mcpToolTestConnection.id,
        ])
        mcpToolFixture.state.protocol = "2026-07-28"
        mcpToolFixture.state.badOutput = true
        const set = yield* tools.acquire(mcpToolTestActor)
        yield* Effect.promise(() =>
          expect(set.tools[0]!.execute!({ region: "eu" }, undefined)).rejects.toThrow(),
        )
        expect(mcpToolFixture.state.calls).toBe(1)
      }),
    )
  })
  test("does not replay a tool call when its response is lost", async () => {
    await withMcpTools((tools) =>
      Effect.gen(function* () {
        const set = yield* tools.acquire(mcpToolTestActor)
        mcpToolFixture.state.lostToolResponse = true
        yield* Effect.promise(() =>
          expect(set.tools[0]!.execute!({ region: "eu" }, undefined)).rejects.toThrow(),
        )
        expect(mcpToolFixture.state.calls).toBe(1)
      }),
    )
  })
  test("cancellation aborts the request without replaying it", async () => {
    await withMcpTools((tools) =>
      Effect.gen(function* () {
        const set = yield* tools.acquire(mcpToolTestActor)
        const controller = new AbortController()
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        mcpToolFixture.state.toolGate = () => gate
        const pending = Promise.resolve(
          set.tools[0]!.execute!({ region: "eu" }, { abortSignal: controller.signal }),
        )
        const failed = pending.then(
          () => false,
          () => true,
        )
        yield* Effect.promise(() => vi.waitFor(() => expect(mcpToolFixture.state.calls).toBe(1)))
        controller.abort()
        yield* Effect.promise(async () => {
          try {
            expect(await failed).toBe(true)
          } finally {
            release()
          }
        })
        expect(mcpToolFixture.state.calls).toBe(1)
      }),
    )
  })
})
