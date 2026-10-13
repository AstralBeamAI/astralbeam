import type { JwtOptions } from "../api/api.ts"
import {
  personalMcpGetCatalog,
  personalMcpCreateConnection,
  personalMcpSetHeaders,
  personalMcpDisconnectConnection,
  personalMcpTestConnection,
  personalMcpAuthorizeConnection,
  personalMcpBindBrowser,
  personalMcpCompleteAuthorization,
} from "../api/generated/api.ts"
import { runMcpAuthorization } from "./mcp-authorization.ts"

export type McpManagementOperation =
  | { action: "connect"; mcpServerId: string }
  | { action: "headers"; mcpServerId: string; headers: Record<string, string> }
  | { action: "disconnect" | "test"; id: string }
export type McpCatalog = Awaited<ReturnType<typeof personalMcpGetCatalog>>
export function loadMcpCatalog(options: JwtOptions): Promise<McpCatalog> {
  return personalMcpGetCatalog(options)
}
export async function manageMcp(operation: McpManagementOperation, options: JwtOptions) {
  switch (operation.action) {
    case "connect":
      return personalMcpCreateConnection({ mcp_server_id: operation.mcpServerId }, options)
    case "headers": {
      const connection = await personalMcpCreateConnection(
        { mcp_server_id: operation.mcpServerId },
        options,
      )
      return personalMcpSetHeaders(
        connection.id,
        { lock_version: connection.lock_version, headers: operation.headers },
        options,
      )
    }
    case "disconnect":
      return personalMcpDisconnectConnection(operation.id, options)
    case "test":
      return personalMcpTestConnection(operation.id, options)
  }
}
export async function connectMcpAccount(
  input: { mcpServerId: string; id?: string },
  requestOptions: () => Promise<JwtOptions>,
) {
  await runMcpAuthorization({
    start: async () => {
      const id =
        input.id ??
        (
          await personalMcpCreateConnection(
            { mcp_server_id: input.mcpServerId },
            await requestOptions(),
          )
        ).id
      const response = await personalMcpAuthorizeConnection(id, await requestOptions())
      return {
        popupUrl: response.popup_url,
        attempt: {
          organizationId: response.attempt.organization_id,
          tenantId: response.attempt.tenant_id,
          connectionId: response.attempt.connection_id,
          id: response.attempt.id,
        },
      }
    },
    bind: async (attempt, challenge) => {
      await personalMcpBindBrowser(
        attempt.connectionId,
        { attempt_id: attempt.id, challenge },
        await requestOptions(),
      )
    },
    complete: async (attempt) => {
      await personalMcpCompleteAuthorization(
        attempt.connectionId,
        { attempt_id: attempt.id },
        await requestOptions(),
      )
    },
  })
}
