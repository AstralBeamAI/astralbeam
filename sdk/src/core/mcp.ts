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
    case "headers": {
      const connection = await personalMcpCreateConnection(
        { mcp_server_id: operation.mcpServerId },
        options,
      )
      if (operation.action === "connect") return connection
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
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    let phase:
      | { state: "waiting" }
      | { state: "binding"; challenge: string }
      | { state: "completing" } = { state: "waiting" }
    const controller = new AbortController()
    let completing = false
    const fail = (error: unknown) =>
      reject(error instanceof Error ? error : new Error("Authorization failed."))
    const authorizationOptions = async () => {
      const options = await requestOptions()
      controller.signal.throwIfAborted()
      return {
        ...options,
        signal: AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]),
      }
    }
    const complete = async () => {
      if (completing || controller.signal.aborted) return
      completing = true
      try {
        if (phase.state === "binding") {
          await personalMcpBindBrowser(
            id,
            { attempt_id: attempt.id, challenge: phase.challenge },
            await authorizationOptions(),
          )
          controller.signal.throwIfAborted()
          phase = { state: "completing" }
        }
        if (phase.state === "completing") {
          const connected = await personalMcpCompleteAuthorization(
            id,
            { attempt_id: attempt.id },
            await authorizationOptions(),
          )
          controller.signal.throwIfAborted()
          if (connected) {
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
        phase.state === "waiting" &&
        typeof data.challenge === "string"
      ) {
        phase = { state: "binding", challenge: data.challenge }
        void complete()
      }
    }
    const poll = setInterval(() => void complete(), 5_000)
    const expiry = setTimeout(
      () => fail(new Error("Authorization expired. Try connecting again.")),
      600_000,
    )
    try {
      window.addEventListener("message", receive)
      popup.location.replace(url.href)
      await promise
    } finally {
      controller.abort()
      window.removeEventListener("message", receive)
      clearInterval(poll)
      clearTimeout(expiry)
    }
    return id
  } finally {
    popup.close()
  }
}
