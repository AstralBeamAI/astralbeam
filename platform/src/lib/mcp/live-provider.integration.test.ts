import { Effect } from "effect"
import { expect, test } from "vitest"
import { McpTools } from "./tools.server.ts"
import type { McpActor } from "./schemas.ts"

const liveOrganizationId = globalThis.process.env.MCP_LIVE_ORGANIZATION_ID
const liveTenantId = globalThis.process.env.MCP_LIVE_TENANT_ID
const liveTenantUserId = globalThis.process.env.MCP_LIVE_TENANT_USER_ID
const liveConnections = globalThis.process.env.MCP_LIVE_CONNECTION_IDS?.split(",") ?? []
test.skipIf(!liveConnections.length || !liveOrganizationId || !liveTenantId || !liveTenantUserId)(
  "lists and exposes tools from explicitly configured live accounts",
  async () => {
    const actor: McpActor = {
      organizationId: liveOrganizationId!,
      tenantId: liveTenantId!,
      tenantUserId: liveTenantUserId!,
    }
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* (yield* McpTools).acquire(actor)
          for (const id of liveConnections) {
            const exposed = result.tools.filter((tool) => tool.metadata.connectionId === id)
            expect(exposed.length, `Tools for connection ${id}`).toBeGreaterThan(0)
            expect(result.unavailable).not.toContain(id)
            console.info({
              connectionId: id,
              tools: exposed.map((tool) => tool.metadata.nativeToolName),
            })
          }
        }),
      ).pipe(Effect.provide(McpTools.layer)),
    )
  },
  120_000,
)
