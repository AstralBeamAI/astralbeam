import { Effect, Layer, Redacted } from "effect"
import { describe, expect, test, vi } from "vitest"
const mcpFixtureFetch = vi.hoisted(() => ({ fetch: globalThis.fetch }))
vi.mock("./network.server.ts", async (original) => ({
  ...(await original<typeof import("./network.server.ts")>()),
  mcpGuardedFetch: (_dispatcher: unknown, input: string | URL | Request, init?: RequestInit) =>
    mcpFixtureFetch.fetch(input, init),
}))
import { McpTools } from "./tools.server.ts"
import { McpConnections } from "./mcp.server.ts"
import { McpAuthorization } from "./authorization.server.ts"
import { startMcpFixture } from "./fixture.ts"
import type { McpActor, McpAuthConfig, McpCredential, McpReference } from "./schemas.ts"
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
let mcpToolFixture: Awaited<ReturnType<typeof startMcpFixture>>
async function withMcpTools(
  inspect: (
    set: Effect.Success<ReturnType<typeof McpTools.Service.acquire>>,
  ) => void | Promise<void>,
  options: {
    credential?: (input: { expectedVersion?: number }) => McpCredential
    authConfig?: McpAuthConfig
    catalog?: (typeof mcpToolTestConnection)[]
    state?: Partial<typeof mcpToolFixture.state>
  } = {},
) {
  mcpToolFixture = await startMcpFixture()
  Object.assign(mcpToolFixture.state, options.state)
  mcpFixtureFetch.fetch = mcpToolFixture.fetch
  const catalog = options.catalog ?? [mcpToolTestConnection]
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tools = yield* McpTools
          const set = yield* tools.acquire(mcpToolTestActor)
          yield* Effect.promise(() => Promise.resolve(inspect(set)))
        }),
      ).pipe(
        Effect.provide(
          McpTools.layerNoDeps.pipe(
            Layer.provide([
              Layer.succeed(McpConnections, {
                catalog: () => Effect.succeed({ connections: catalog }),
                getConnection: ({ reference }: { reference: McpReference }) =>
                  Effect.succeed({
                    connection: catalog.find((entry) => entry.id === reference.id),
                    server: {
                      id: "019a0000-0000-7000-8000-000000000004",
                      endpointUrl: `https://fixture.example/mcp?connection=${reference.id}`,
                      authConfig: options.authConfig ?? { kind: "none" },
                    },
                  }),
              } as unknown as typeof McpConnections.Service),
              Layer.succeed(McpAuthorization, {
                getCredential: (input: { expectedVersion?: number }) =>
                  Effect.sync(() => Redacted.make(options.credential?.(input) ?? { kind: "none" })),
              } as unknown as typeof McpAuthorization.Service),
            ]),
          ),
        ),
      ),
    )
  } finally {
    await mcpToolFixture.close()
  }
}
describe("request-oriented MCP tools", () => {
  test("static and OAuth tools cannot dispatch a replacement account", async () => {
    for (const kind of ["static_headers", "oauth"] as const) {
      let generation = 0
      await withMcpTools(
        async (set) => {
          generation++
          await expect(set.tools[0]!.execute!({ region: "eu" }, undefined)).rejects.toThrow()
          expect(mcpToolFixture.state.calls).toBe(0)
        },
        {
          credential: ({ expectedVersion }) => {
            if (expectedVersion !== generation) throw new Error("Account replaced")
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
          authConfig:
            kind === "static_headers"
              ? { kind, headerNames: ["Authorization"] }
              : { kind, profile: "standard", requestedScopes: [] },
        },
      )
    }
  })
  test("discovers paginated tools and executes JSON and SSE responses", async () => {
    for (const sse of [false, true])
      await withMcpTools(
        async (set) => {
          expect(set.unavailable).toEqual([])
          expect(set.tools).toHaveLength(1)
          const tool = set.tools[0]!
          expect(tool.description).toContain("https://fixture.example/mcp?connection=")
          const schema = tool.inputSchema as { "~standard": { validate(input: unknown): unknown } }
          expect(schema["~standard"].validate({ region: 3 })).toHaveProperty("issues")
          expect(await tool.execute!({ region: "eu" }, undefined)).toEqual({ ok: true })
          expect(mcpToolFixture.state.calls).toBe(1)
          const call = mcpToolFixture.state.requests.find((entry) => entry.method === "tools/call")!
          expect(call.headers).toMatchObject({
            "mcp-method": "tools/call",
            "mcp-protocol-version": "2026-07-28",
          })
        },
        { state: { sse } },
      )
  })
  test("keeps healthy tools while omitting stale accounts and oversized combined catalogs", async () => {
    const catalog = [3, 5, 6, 7].map((suffix) => ({
      ...mcpToolTestConnection,
      id: `019a0000-0000-7000-8000-00000000000${suffix}`,
      authState: suffix === 7 ? "reauthorization_required" : "connected",
    }))
    for (const state of [
      { toolCount: 100, catalogDescription: "", exposed: 200 },
      { toolCount: 1, catalogDescription: "x".repeat(400_000), exposed: 2 },
    ])
      await withMcpTools(
        (set) => {
          expect(set.tools).toHaveLength(state.exposed)
          expect(set.unavailable).toEqual([catalog[3]!.id, catalog[2]!.id])
          expect(
            mcpToolFixture.state.requests.filter((entry) => entry.method === "server/discover"),
          ).toHaveLength(3)
        },
        { catalog, state },
      )
  })
  test("rejects legacy protocol without initializing a session", async () => {
    await withMcpTools(
      (set) => {
        expect(set.unavailable).toEqual([mcpToolTestConnection.id])
        expect(mcpToolFixture.state.requests.map((entry) => entry.method)).toEqual([
          "server/discover",
        ])
      },
      { state: { protocol: "2025-11-25" } },
    )
  })
  test("does not replay a tool call when its response is lost", async () => {
    await withMcpTools(async (set) => {
      mcpToolFixture.state.lostToolResponse = true
      await expect(set.tools[0]!.execute!({ region: "eu" }, undefined)).rejects.toThrow()
      expect(mcpToolFixture.state.calls).toBe(1)
    })
  })
  test("cancellation aborts the request without replaying it", async () => {
    await withMcpTools(async (set) => {
      const controller = new AbortController()
      const observeFetch = vi.fn(mcpFixtureFetch.fetch)
      mcpFixtureFetch.fetch = observeFetch
      let release!: () => void
      mcpToolFixture.state.toolGate = () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
      const failed = Promise.resolve(
        set.tools[0]!.execute!({ region: "eu" }, { abortSignal: controller.signal }),
      ).then(
        () => false,
        () => true,
      )
      await vi.waitFor(() => expect(mcpToolFixture.state.calls).toBe(1))
      controller.abort()
      expect(observeFetch.mock.calls.at(-1)![1]!.signal!.aborted).toBe(true)
      try {
        expect(await failed).toBe(true)
      } finally {
        release()
      }
      expect(mcpToolFixture.state.calls).toBe(1)
    })
  })
})
