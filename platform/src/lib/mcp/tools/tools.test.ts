import { Effect, Layer, Redacted, Scope } from "effect"
import { afterEach, describe, expect, test, vi } from "vitest"
const mcpFixtureFetch = vi.hoisted(() => ({ fetch: globalThis.fetch }))
vi.mock("../network.server.ts", async (original) => ({
  ...(await original<typeof import("../network.server.ts")>()),
  mcpGuardedFetch: (_dispatcher: unknown, input: string | URL | Request, init?: RequestInit) =>
    mcpFixtureFetch.fetch(input, init),
}))
import { McpTools } from "./tools.ts"
import { McpConnections } from "../mcp.server.ts"
import { McpAuthorization } from "../authorization/authorization.ts"
import { startMcpFixture } from "../testing/fixture.ts"
import type { McpActor, McpAuthConfig, McpCredential, McpReference } from "../schemas.ts"
const mcpToolTestActor: McpActor = {
  organizationId: "019a0000-0000-7000-8000-000000000001",
  tenantId: "019a0000-0000-7000-8000-000000000010",
  tenantUserId: "019a0000-0000-7000-8000-000000000011",
}
const mcpToolTestConnection = {
  ...mcpToolTestActor,
  id: "019a0000-0000-7000-8000-000000000003",
  authState: "connected",
  lockVersion: 0,
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
  getCredential: (input: { expectedVersion?: number }) => McpCredential = () => ({ kind: "none" }),
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
              getCredential: (input: { expectedVersion?: number }) =>
                Effect.sync(() => Redacted.make(getCredential(input))),
            } as unknown as typeof McpAuthorization.Service),
          ]),
        ),
      ),
    ),
  )
}
describe("request-oriented MCP tools", () => {
  test.each(["static_headers", "oauth"] as const)(
    "%s tools cannot dispatch a replacement account",
    async (kind) => {
      let generation = mcpToolTestConnection.lockVersion
      await withMcpTools(
        (tools) =>
          Effect.gen(function* () {
            const set = yield* tools.acquire(mcpToolTestActor)
            generation = 1
            yield* Effect.promise(() =>
              expect(set.tools[0]!.execute!({ region: "eu" }, undefined)).rejects.toThrow(),
            )
            expect(mcpToolFixture.state.calls).toBe(0)
          }),
        ({ expectedVersion }) => {
          if (expectedVersion !== undefined && expectedVersion !== generation)
            throw new Error("Account replaced")
          return kind === "static_headers"
            ? { kind, headers: { Authorization: `Bearer account-${generation}` } }
            : {
                kind,
                clientInformation: {},
                tokens: { access_token: `account-${generation}`, token_type: "Bearer" },
                expiresAt: null,
                discovery: {},
              }
        },
        kind === "static_headers"
          ? { kind, headerNames: ["Authorization"] }
          : { kind, profile: "standard", requestedScopes: [] },
      )
    },
  )
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
          expect(call.headers["mcp-method"]).toBe("tools/call")
          expect(call.headers["mcp-protocol-version"]).toBe("2026-07-28")
          expect(
            mcpToolFixture.state.requests.some((request) => request.method === "initialize"),
          ).toBe(false)
        }),
      )
    },
  )
  test("reports accounts needing authorization without opening them or hiding healthy tools", async () => {
    const stale = {
      ...mcpToolTestConnection,
      id: "019a0000-0000-7000-8000-000000000005",
      authState: "reauthorization_required",
    }
    await withMcpTools(
      (tools) =>
        Effect.gen(function* () {
          const set = yield* tools.acquire(mcpToolTestActor)
          expect(set.tools).toHaveLength(1)
          expect(set.unavailable).toEqual([stale.id])
          expect(
            mcpToolFixture.state.requests.filter((request) => request.method === "server/discover"),
          ).toHaveLength(1)
        }),
      undefined,
      undefined,
      [mcpToolTestConnection, stale],
    )
  })
  test.each([
    { boundary: "count", toolCount: 100, catalogDescription: "", exposed: 200 },
    { boundary: "bytes", toolCount: 1, catalogDescription: "x".repeat(400_000), exposed: 2 },
  ])("bounds the combined catalog by $boundary", async (input) => {
    const catalog = [
      mcpToolTestConnection,
      ...[5, 6].map((suffix) => ({
        ...mcpToolTestConnection,
        id: `019a0000-0000-7000-8000-00000000000${suffix}`,
      })),
    ]
    await withMcpTools(
      (tools) =>
        Effect.gen(function* () {
          Object.assign(mcpToolFixture.state, input)
          const set = yield* tools.acquire(mcpToolTestActor)
          expect(set.tools).toHaveLength(input.exposed)
          expect(set.unavailable).toEqual([catalog[2]!.id])
        }),
      undefined,
      undefined,
      catalog,
    )
  })
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
