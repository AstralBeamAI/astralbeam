import type { JwtOptions } from "../api/api.ts"
import {
  mcpAuthorizationGetCatalog,
  mcpAuthorizationBindBrowser,
  mcpAuthorizationCompleteAuthorization,
  personalMcpCreateServer,
  personalMcpUpdateServer,
  personalMcpDeleteServer,
  personalMcpCreateConnection,
  personalMcpUpdateConnection,
  personalMcpDeleteConnection,
  personalMcpAuthorizeConnection,
  personalMcpDisconnectConnection,
  personalMcpTestConnection,
  tenantMcpCreateServer,
  tenantMcpUpdateServer,
  tenantMcpDeleteServer,
  tenantMcpCreateConnection,
  tenantMcpUpdateConnection,
  tenantMcpDeleteConnection,
  tenantMcpAuthorizeConnection,
  tenantMcpDisconnectConnection,
  tenantMcpTestConnection,
  type McpServerInputEncoded,
  type McpConnectionInputEncoded,
  type PersonalMcpAuthorizeConnectionBody,
} from "../api/generated/api.ts"
import { runMcpAuthorization } from "./mcp-authorization.ts"

export type McpManagementOperation = { scope: "personal" | "tenant"; tenantId?: string } & (
  | { action: "server"; id?: string; fields: McpServerInputEncoded }
  | { action: "connection"; id?: string; fields: McpConnectionInputEncoded }
  | { action: "delete_server" | "delete_connection"; id: string; lockVersion: number }
  | { action: "disconnect" | "test"; id: string }
)
export type McpCatalog = Awaited<ReturnType<typeof mcpAuthorizationGetCatalog>>
export function loadMcpCatalog(options: JwtOptions): Promise<McpCatalog> {
  return mcpAuthorizationGetCatalog(options)
}
export async function manageMcp(operation: McpManagementOperation, options: JwtOptions) {
  const tenantId = operation.scope === "tenant" ? operation.tenantId : undefined
  if (operation.scope === "tenant" && !tenantId)
    throw new Error("A Tenant is required for shared connections.")
  const api = {
    createServer: tenantId ? tenantMcpCreateServer.bind(null, tenantId) : personalMcpCreateServer,
    updateServer: tenantId ? tenantMcpUpdateServer.bind(null, tenantId) : personalMcpUpdateServer,
    deleteServer: tenantId ? tenantMcpDeleteServer.bind(null, tenantId) : personalMcpDeleteServer,
    createConnection: tenantId
      ? tenantMcpCreateConnection.bind(null, tenantId)
      : personalMcpCreateConnection,
    updateConnection: tenantId
      ? tenantMcpUpdateConnection.bind(null, tenantId)
      : personalMcpUpdateConnection,
    deleteConnection: tenantId
      ? tenantMcpDeleteConnection.bind(null, tenantId)
      : personalMcpDeleteConnection,
    disconnectConnection: tenantId
      ? tenantMcpDisconnectConnection.bind(null, tenantId)
      : personalMcpDisconnectConnection,
    testConnection: tenantId
      ? tenantMcpTestConnection.bind(null, tenantId)
      : personalMcpTestConnection,
  }
  switch (operation.action) {
    case "server":
      return operation.id
        ? api.updateServer(operation.id, operation.fields, options)
        : api.createServer(operation.fields, options)
    case "connection":
      return operation.id
        ? api.updateConnection(operation.id, operation.fields, options)
        : api.createConnection(operation.fields, options)
    case "delete_server":
      return api.deleteServer(
        operation.id,
        { lock_version: String(operation.lockVersion) },
        options,
      )
    case "delete_connection":
      return api.deleteConnection(
        operation.id,
        { lock_version: String(operation.lockVersion) },
        options,
      )
    case "disconnect":
      return api.disconnectConnection(operation.id, options)
    case "test":
      return api.testConnection(operation.id, options)
  }
}
export async function connectMcpAccount(
  input: {
    id: string
    tenantId?: string
    manualClient?: PersonalMcpAuthorizeConnectionBody["manual_client"]
  },
  requestOptions: () => Promise<JwtOptions>,
) {
  await runMcpAuthorization({
    start: async () => {
      const fields = input.manualClient ? { manual_client: input.manualClient } : {}
      const options = await requestOptions()
      const response = input.tenantId
        ? await tenantMcpAuthorizeConnection(input.tenantId, input.id, fields, options)
        : await personalMcpAuthorizeConnection(input.id, fields, options)
      return {
        popupUrl: response.popup_url,
        attempt: {
          id: response.attempt.id,
          organizationId: response.attempt.organization_id,
          tenantId: response.attempt.tenant_id,
        },
      }
    },
    bind: async (attempt, challenge) => {
      await mcpAuthorizationBindBrowser(
        attempt.id,
        { ...(attempt.tenantId ? { tenant_id: attempt.tenantId } : {}), challenge },
        await requestOptions(),
      )
    },
    complete: async (attempt) => {
      await mcpAuthorizationCompleteAuthorization(
        attempt.id,
        attempt.tenantId ? { tenant_id: attempt.tenantId } : {},
        await requestOptions(),
      )
    },
  })
}
