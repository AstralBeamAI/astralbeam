import { Effect, Layer, Redacted } from "effect"
import { describe, expect, test, vi } from "vitest"
const mcpFixtureFetch = vi.hoisted<{
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}>(() => ({ fetch: globalThis.fetch }))
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
    tools: typeof McpTools.Service,
  ) => void | Promise<void>,
  options: {
    credential?: (input: {
      reference: McpReference
      expectedVersion?: number
      rejectedToken?: string
    }) => McpCredential | Effect.Effect<McpCredential>
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
          yield* Effect.promise(() => Promise.resolve(inspect(set, tools)))
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
                getCredential: (input: Parameters<NonNullable<typeof options.credential>>[0]) =>
                  Effect.suspend(() => {
                    const value = options.credential?.(input) ?? { kind: "none" as const }
                    return Effect.map(
                      Effect.isEffect(value) ? value : Effect.succeed(value),
                      Redacted.make,
                    )
                  }),
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
  test("static and OAuth tools cannot dispatch using replaced credentials", async () => {
    for (const kind of ["static_headers", "oauth"] as const) {
      let generation = 0
      await withMcpTools(
        async (set) => {
          generation++
          await expect(set.tools[0]!.execute({ region: "eu" }, undefined)).rejects.toThrow()
          expect(mcpToolFixture.state.calls).toBe(0)
        },
        {
          credential: ({ expectedVersion }) => {
            if (expectedVersion !== generation) throw new Error("Credentials replaced")
            return kind === "static_headers"
              ? { kind, headers: { Authorization: `Bearer account-${generation}` } }
              : {
                  kind,
                  clientInformation: {},
                  tokens: { access_token: `account-${generation}`, token_type: "Bearer" },
                  expiresAt: null,
                  discovery: { authorizationServerUrl: "https://fixture.example" },
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
  test("discovers paginated tools and mirrors input headers for JSON and SSE responses", async () => {
    for (const sse of [false, true])
      await withMcpTools(
        async (set) => {
          expect(set.unavailable).toEqual([])
          expect(set.tools).toHaveLength(1)
          const tool = set.tools[0]!
          const regions = [
            ["eu", "eu"],
            ["", "=?base64??="],
            ["é", "=?base64?w6k=?="],
            [" eu ", "=?base64?IGV1IA==?="],
            ["a\r\nb", "=?base64?YQ0KYg==?="],
            ["a\tb", "a\tb"],
            ["=?base64?YQ==?=", "=?base64?PT9iYXNlNjQ/WVE9PT89?="],
          ]
          for (const [region, header] of regions) {
            expect(await tool.execute({ region }, undefined)).toEqual({ ok: true })
            expect(mcpToolFixture.state.regionHeader).toBe(header)
          }
          expect(mcpToolFixture.state.calls).toBe(regions.length)
        },
        { state: { sse } },
      )
  })
  test("omits invalid header schemas during discovery while retaining healthy tools", async () => {
    const header = { type: "string", "x-mcp-header": "Region" }
    const literal = { "x-mcp-header": "literal data" }
    const valid = {
      type: "object",
      properties: {
        nested: { type: "object", properties: { region: { ...header, type: "integer" } } },
        toString: { ...header, "x-mcp-header": "Method" },
        data: { type: "object", const: literal, enum: [literal], default: literal },
      },
    }
    const invalid = [
      { properties: { region: { ...header, "x-mcp-header": "bad name" } } },
      { properties: { region: { ...header, "x-mcp-header": "" } } },
      { properties: { region: { ...header, "x-mcp-header": 1 } } },
      { properties: { region: { ...header, type: "number" } } },
      { properties: { region: { ...header, type: ["string"] } } },
      {
        properties: {
          region: header,
          nested: {
            type: "object",
            properties: { region: { ...header, "x-mcp-header": "REGION" } },
          },
        },
      },
      { oneOf: [{ properties: { region: header } }] },
      { "x-mcp-header": "Root" },
      { $defs: { region: header } },
      { dependencies: { region: { properties: { region: header } } } },
      { properties: { regions: { type: "array", items: header } } },
      { properties: { regions: { type: "array", additionalItems: header } } },
    ]
    await withMcpTools(
      async (set) => {
        expect(set.unavailable).toEqual([])
        expect(set.tools.map((tool) => tool.metadata.nativeToolName)).toEqual(["lookup", "nested"])
        expect(set.tools[1]!.metadata.originalInputSchema).toEqual(valid)
        expect(mcpToolFixture.state.calls).toBe(0)
        await set.tools[1]!.execute({ nested: { region: 42 } }, undefined)
        expect(mcpToolFixture.state.regionHeader).toBe("42")
        await expect(
          set.tools[1]!.execute({ nested: { region: 2 ** 53 } }, undefined),
        ).rejects.toThrow()
        expect(mcpToolFixture.state.calls).toBe(1)
        await set.tools[1]!.execute(Object.create({ nested: { region: 42 } }), undefined)
        expect(mcpToolFixture.state.regionHeader).toBeUndefined()
        expect(mcpToolFixture.state.calls).toBe(2)
      },
      {
        state: {
          extraTools: [
            ...invalid.map((schema, index) => ({
              name: `invalid_${index}`,
              inputSchema: { type: "object", ...schema },
            })),
            { name: "nested", inputSchema: valid },
          ],
        },
      },
    )
  })
  test("counts catalog pages without counting an OAuth retry", async () => {
    for (const listPages of [8, 9]) {
      let refreshes = 0
      await withMcpTools(
        (set) => {
          expect(refreshes).toBe(1)
          expect(set.tools).toHaveLength(listPages === 8 ? 1 : 0)
          expect(set.unavailable).toEqual(listPages === 8 ? [] : [mcpToolTestConnection.id])
          expect(
            mcpToolFixture.state.requests.filter((method) => method === "tools/list"),
          ).toHaveLength(9)
        },
        {
          authConfig: { kind: "oauth", profile: "standard", requestedScopes: [] },
          state: { listPages, rejectedListToken: "access-0" },
          credential: ({ rejectedToken }) => {
            if (rejectedToken) refreshes++
            return {
              kind: "oauth",
              clientInformation: {},
              tokens: { access_token: `access-${refreshes}`, token_type: "Bearer" },
              expiresAt: null,
              discovery: { authorizationServerUrl: "https://fixture.example" },
            }
          },
        },
      )
    }
  })
  test("keeps healthy tools while omitting stale and broken connections", async () => {
    const catalog = [3, 5, 6, 7].map((suffix) => ({
      ...mcpToolTestConnection,
      id: `019a0000-0000-7000-8000-00000000000${suffix}`,
      authState: suffix === 7 ? "reauthorization_required" : "connected",
    }))
    await withMcpTools(
      (set) => {
        expect(set.tools).toHaveLength(2)
        expect(set.unavailable).toEqual([catalog[3]!.id, catalog[2]!.id])
      },
      {
        catalog,
        credential: ({ reference }) => {
          if (reference.id === catalog[2]!.id) throw new Error("Connection unavailable")
          return { kind: "none" }
        },
      },
    )
  })
  test("explains unsupported protocol without initializing a session", async () => {
    await withMcpTools(
      async (set, tools) => {
        expect(set.unavailable).toEqual([mcpToolTestConnection.id])
        await expect(
          Effect.runPromise(
            tools.test({ actor: mcpToolTestActor, reference: mcpToolTestConnection }),
          ),
        ).rejects.toThrow("Could not connect using MCP 2026-07-28")
        expect(mcpToolFixture.state.requests).toEqual(["server/discover", "server/discover"])
      },
      { state: { protocol: "2025-11-25" } },
    )
  })
  test("does not replay a tool call when its response is lost", async () => {
    await withMcpTools(async (set) => {
      mcpToolFixture.state.lostToolResponse = true
      await expect(set.tools[0]!.execute({ region: "eu" }, undefined)).rejects.toThrow()
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
        set.tools[0]!.execute(
          { region: "eu" },
          { abortSignal: controller.signal, emitCustomEvent: vi.fn() },
        ),
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
  test("cancellation interrupts credential resolution before dispatch", async () => {
    let waiting = false
    const interrupted = vi.fn<() => void>()
    const pending = vi.fn(() =>
      Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(interrupted))),
    )
    await withMcpTools(
      async (set) => {
        waiting = true
        const controller = new AbortController()
        const failed = Promise.resolve(
          set.tools[0]!.execute(
            { region: "eu" },
            { abortSignal: controller.signal, emitCustomEvent: vi.fn() },
          ),
        ).then(
          () => false,
          () => true,
        )
        await vi.waitFor(() => expect(pending).toHaveBeenCalledOnce())
        controller.abort()
        await vi.waitFor(() => expect(interrupted).toHaveBeenCalledOnce())
        expect(await failed).toBe(true)
        expect(mcpToolFixture.state.calls).toBe(0)
      },
      { credential: () => (waiting ? pending() : { kind: "none" }) },
    )
  })
})
