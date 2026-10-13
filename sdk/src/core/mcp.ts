import type { JwtOptions } from "../api/api.ts"
import {
  personalMcpGetCatalog,
  personalMcpCreateConnection,
  personalMcpSetHeaders,
  personalMcpDeleteConnection,
  personalMcpDisconnectConnection,
  personalMcpTestConnection,
  personalMcpAuthorizeConnection,
  personalMcpBindBrowser,
  personalMcpCompleteAuthorization,
} from "../api/generated/api.ts"
import { runMcpAuthorization } from "./mcp-authorization.ts"

export type McpManagementOperation =
  | { action: "connect"; serverId: string }
  | { action: "headers"; serverId: string; headers: Record<string, string> }
  | { action: "disconnect" | "delete_connection" | "test"; id: string }
export type McpCatalog = Awaited<ReturnType<typeof personalMcpGetCatalog>>
export function loadMcpCatalog(options: JwtOptions): Promise<McpCatalog> {
  return personalMcpGetCatalog(options)
}
export async function manageMcp(operation: McpManagementOperation, options: JwtOptions) {
  switch (operation.action) {
    case "connect":
      return personalMcpCreateConnection({ server_id: operation.serverId }, options)
    case "headers": {
      const connection = await personalMcpCreateConnection(
        { server_id: operation.serverId },
        options,
      )
      return personalMcpSetHeaders(
        connection.id,
        { lock_version: connection.lock_version, headers: operation.headers },
        options,
      )
    }
    case "delete_connection":
      return personalMcpDeleteConnection(operation.id, options)
    case "disconnect":
      return personalMcpDisconnectConnection(operation.id, options)
    case "test":
      return personalMcpTestConnection(operation.id, options)
  }
}
export async function connectMcpAccount(
  input: { serverId: string; id?: string },
  requestOptions: () => Promise<JwtOptions>,
) {
  await runMcpAuthorization({
    start: async () => {
      const id =
        input.id ??
        (await personalMcpCreateConnection({ server_id: input.serverId }, await requestOptions()))
          .id
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
