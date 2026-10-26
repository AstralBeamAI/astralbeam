import type { JwtOptions } from "../api/api.ts"
import {
  type personalMcpGetCatalog,
  personalMcpCreateConnection,
  personalMcpSetHeaders,
  personalMcpDisconnectConnection,
  personalMcpTestConnection,
  personalMcpAuthorizeConnection,
  personalMcpBindBrowser,
  personalMcpCompleteAuthorization,
} from "../api/generated/api.ts"

export type McpConnectionOperation =
  | { action: "connect"; mcpServerId: string }
  | { action: "headers"; mcpServerId: string; headers: Record<string, string> }
  | { action: "disconnect" | "test"; id: string }
export type McpCatalog = Awaited<ReturnType<typeof personalMcpGetCatalog>>
export async function manageMcpConnection(operation: McpConnectionOperation, options: JwtOptions) {
  switch (operation.action) {
    case "connect":
      return personalMcpCreateConnection({ mcp_server_id: operation.mcpServerId }, options)
    case "headers": {
      const connection = await personalMcpCreateConnection(
        { mcp_server_id: operation.mcpServerId },
        options,
      )
      await personalMcpSetHeaders(
        connection.id,
        { lock_version: connection.lock_version, headers: operation.headers },
        options,
      )
      return { id: connection.id }
    }
    case "disconnect":
      return personalMcpDisconnectConnection(operation.id, options)
    case "test":
      return personalMcpTestConnection(operation.id, options)
  }
}
export async function authorizeMcpConnection(
  input: { mcpServerId: string; id?: string },
  requestOptions: () => Promise<JwtOptions>,
) {
  // Open before awaiting authentication so browsers retain the initiating user gesture.
  const popup = window.open("about:blank", "_blank", "popup,width=600,height=720")
  if (!popup) throw new Error("Allow popups to authorize this connection.")
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
      let challenge: string | undefined
      let bound = false
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
      const complete = async () => {
        if (completing || finished) return
        completing = true
        try {
          if (challenge) {
            if (!bound) {
              await personalMcpBindBrowser(
                id,
                { attempt_id: attempt.id, challenge },
                await requestOptions(),
              )
              bound = true
            }
            if (finished) return
            const connected = await personalMcpCompleteAuthorization(
              id,
              { attempt_id: attempt.id },
              await requestOptions(),
            )
            if (finished) return
            if (connected) {
              cleanup()
              resolve()
              return
            }
          }
          if (popup.closed) fail(new Error("Authorization window closed."))
        } catch (error) {
          const status =
            error instanceof Error ? (error as Error & { status?: number }).status : undefined
          if (!(error instanceof TypeError) && status !== 429 && (status ?? 0) < 500) fail(error)
        } finally {
          completing = false
        }
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
          !challenge &&
          typeof data.challenge === "string"
        ) {
          challenge = data.challenge
          void complete()
        }
      }
      const poll = setInterval(() => void complete(), 5_000)
      const expiry = setTimeout(
        () => fail(new Error("Authorization expired. Try connecting again.")),
        600_000,
      )
      window.addEventListener("message", receive)
      popup.location.replace(url.href)
    })
    return id
  } finally {
    popup.close()
  }
}
