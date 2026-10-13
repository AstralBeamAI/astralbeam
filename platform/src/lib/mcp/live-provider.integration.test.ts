import { Effect, Layer, ManagedRuntime } from "effect"
import { afterAll, expect, test } from "vitest"
import { McpConnections } from "./mcp.server.ts"
import { McpTools } from "./tools/tools.ts"
import type { McpActor } from "./schemas.ts"

const liveOrganizationId = globalThis.process.env.MCP_LIVE_ORGANIZATION_ID
const liveOrganizationUserId = globalThis.process.env.MCP_LIVE_ORGANIZATION_USER_ID
const liveConnections = [
  { name: "DCR", id: globalThis.process.env.MCP_LIVE_DCR_CONNECTION_ID, profile: "standard" },
  {
    name: "manually registered Google",
    id: globalThis.process.env.MCP_LIVE_GOOGLE_CONNECTION_ID,
    profile: "google",
  },
] as const
const createLiveMcpRuntime = () =>
  ManagedRuntime.make(Layer.mergeAll(McpConnections.layer, McpTools.layer))
let runtime: ReturnType<typeof createLiveMcpRuntime> | undefined
afterAll(async () => {
  await runtime?.dispose()
})

for (const { name, id, profile } of liveConnections)
  test.skipIf(!id || !liveOrganizationId || !liveOrganizationUserId)(
    `uses an explicitly configured live ${name} account`,
    async () => {
      const current = (runtime ??= createLiveMcpRuntime())
      const actor: McpActor = {
        organizationId: liveOrganizationId!,
        organizationUserId: liveOrganizationUserId!,
        tenantId: null,
        tenantUserId: null,
        admin: true,
        apiKey: false,
        interactive: true,
      }
      const reference = { organizationId: liveOrganizationId!, tenantId: null, id: id! }
      await current.runPromise(
        Effect.gen(function* () {
          const { server } = yield* (yield* McpConnections).getConnection({ actor, reference })
          expect(server.authConfig).toMatchObject({ kind: "oauth", profile })
          const result = yield* (yield* McpTools).test({ actor, reference })
          expect(result.toolCount).toBeGreaterThan(0)
        }),
      )
    },
    60_000,
  )
