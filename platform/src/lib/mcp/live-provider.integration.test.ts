import { Effect, ManagedRuntime } from "effect"
import { afterAll, expect, test } from "vitest"
import { McpTools } from "./tools/tools.ts"
import type { McpActor } from "./schemas.ts"

const liveOrganizationId = globalThis.process.env.MCP_LIVE_ORGANIZATION_ID
const liveTenantId = globalThis.process.env.MCP_LIVE_TENANT_ID
const liveTenantUserId = globalThis.process.env.MCP_LIVE_TENANT_USER_ID
const liveConnections = globalThis.process.env.MCP_LIVE_CONNECTION_IDS?.split(",") ?? []
const createLiveMcpRuntime = () => ManagedRuntime.make(McpTools.layer)
let runtime: ReturnType<typeof createLiveMcpRuntime> | undefined
afterAll(async () => {
  await runtime?.dispose()
})

test.skipIf(!liveConnections.length || !liveOrganizationId || !liveTenantId || !liveTenantUserId)(
  "lists and exposes tools from explicitly configured live accounts",
  async () => {
    const current = (runtime ??= createLiveMcpRuntime())
    const actor: McpActor = {
      organizationId: liveOrganizationId!,
      tenantId: liveTenantId!,
      tenantUserId: liveTenantUserId!,
    }
    await current.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* (yield* McpTools).acquire(actor)
          for (const id of liveConnections) {
            const exposed = result.presentation.filter((tool) => tool.connectionId === id)
            expect(exposed.length, `Tools for connection ${id}`).toBeGreaterThan(0)
            expect(result.unavailable).not.toContain(id)
            console.info({ connectionId: id, tools: exposed.map((tool) => tool.nativeToolName) })
            for (const tool of exposed)
              expect(
                result.tools.find((definition) => definition.name === tool.name),
              ).toMatchObject({
                metadata: { source: "mcp", connectionId: id, nativeToolName: tool.nativeToolName },
              })
          }
        }),
      ),
    )
  },
  120_000,
)
