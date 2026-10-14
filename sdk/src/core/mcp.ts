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
  // Open before awaiting authentication so browsers retain the initiating user gesture.
  const popup = window.open("about:blank", "_blank", "popup,width=600,height=720")
  if (!popup) throw new Error("Allow popups to connect your account.")
  try {
    const id =
      input.id ??
      (
        await personalMcpCreateConnection(
          { mcp_server_id: input.mcpServerId },
          await requestOptions(),
        )
      ).id
    const response = await personalMcpAuthorizeConnection(id, await requestOptions())
    const attempt = {
      organizationId: response.attempt.organization_id,
      tenantId: response.attempt.tenant_id,
      connectionId: response.attempt.connection_id,
      id: response.attempt.id,
    }
    const url = new URL(response.popup_url)
    url.searchParams.set("origin", window.location.origin)
    await new Promise<void>((resolve, reject) => {
      let binding: Promise<void> | undefined
      let finished = false
      let completing = false
      const cleanup = () => {
        finished = true
        window.removeEventListener("message", receive)
        clearInterval(poll)
        clearTimeout(expiry)
      }
      const fail = (error: unknown) => {
        cleanup()
        reject(error instanceof Error ? error : new Error("Authorization failed."))
      }
      const receive = (event: MessageEvent) => {
        if (event.source !== popup || event.origin !== url.origin) return
        const data = event.data as {
          type?: string
          attempt?: typeof attempt
          challenge?: string
        } | null
        if (
          !data?.attempt ||
          data.attempt.id !== attempt.id ||
          data.attempt.organizationId !== attempt.organizationId ||
          data.attempt.tenantId !== attempt.tenantId ||
          data.attempt.connectionId !== attempt.connectionId
        )
          return
        if (
          data.type === "mcp-browser-challenge" &&
          !binding &&
          typeof data.challenge === "string"
        ) {
          const challenge = data.challenge
          binding = requestOptions().then((options) =>
            personalMcpBindBrowser(id, { attempt_id: attempt.id, challenge }, options),
          )
          void binding.catch(fail)
        }
      }
      const poll = setInterval(() => {
        if (completing || finished) return
        if (popup.closed) return fail(new Error("Authorization window closed."))
        if (!binding) return
        completing = true
        void binding
          .then(async () =>
            finished
              ? false
              : personalMcpCompleteAuthorization(
                  id,
                  { attempt_id: attempt.id },
                  await requestOptions(),
                ),
          )
          .then(
            (connected) => {
              completing = false
              if (connected && !finished) {
                cleanup()
                resolve()
              }
            },
            (error: unknown) => {
              completing = false
              const status =
                error instanceof Error ? (error as Error & { status?: number }).status : undefined
              if (!(error instanceof TypeError) && status !== 429 && (status ?? 0) < 500)
                fail(error)
            },
          )
      }, 5_000)
      const expiry = setTimeout(
        () => fail(new Error("Authorization expired. Try connecting again.")),
        600_000,
      )
      window.addEventListener("message", receive)
      popup.location.replace(url.href)
    })
  } finally {
    popup.close()
  }
}
