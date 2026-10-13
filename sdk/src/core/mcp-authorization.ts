export interface McpAuthorizationAttempt {
  organizationId: string
  tenantId: string | null
  id: string
}

/** Open from a user gesture. The popup never receives the caller's authentication token. */
export async function runMcpAuthorization(options: {
  start: () => Promise<{ attempt: McpAuthorizationAttempt; popupUrl: string }>
  bind: (attempt: McpAuthorizationAttempt, challenge: string) => Promise<void>
  complete: (attempt: McpAuthorizationAttempt) => Promise<void>
  signal?: AbortSignal | undefined
}): Promise<void> {
  const popup = window.open("about:blank", "_blank", "popup,width=600,height=720")
  if (!popup) throw new Error("Allow popups to connect your account.")
  try {
    const started = await options.start()
    const url = new URL(started.popupUrl)
    url.searchParams.set("origin", window.location.origin)
    await new Promise<void>((resolve, reject) => {
      let binding = false
      let bound = false
      let completing = false
      const cleanup = () => {
        window.removeEventListener("message", receive)
        clearInterval(closed)
        clearTimeout(expiry)
        options.signal?.removeEventListener("abort", abort)
      }
      const fail = (error: unknown) => {
        cleanup()
        reject(error instanceof Error ? error : new Error("Authorization failed."))
      }
      const abort = () => fail(new DOMException("Authorization cancelled", "AbortError"))
      const receive = (event: MessageEvent) => {
        if (event.source !== popup || event.origin !== url.origin) return
        const data = event.data as {
          type?: string
          attempt?: McpAuthorizationAttempt
          challenge?: string
          status?: string
        } | null
        if (
          !data?.attempt ||
          data.attempt.id !== started.attempt.id ||
          data.attempt.organizationId !== started.attempt.organizationId ||
          data.attempt.tenantId !== started.attempt.tenantId
        )
          return
        if (data.type === "mcp-authorization-result" && data.status === "failed") {
          fail(new Error("Authorization failed. Try connecting again."))
          return
        }
        if (
          data.type === "mcp-browser-challenge" &&
          !binding &&
          typeof data.challenge === "string"
        ) {
          binding = true
          void options.bind(started.attempt, data.challenge).then(() => {
            bound = true
          }, fail)
        }
        if (
          data.type === "mcp-authorization-result" &&
          data.status === "awaiting_completion" &&
          bound &&
          !completing
        ) {
          completing = true
          void options.complete(started.attempt).then(() => {
            cleanup()
            resolve()
          }, fail)
        }
      }
      const closed = setInterval(() => {
        if (popup.closed && !completing) fail(new Error("Authorization window closed."))
      }, 500)
      const expiry = setTimeout(
        () => fail(new Error("Authorization expired. Try connecting again.")),
        600_000,
      )
      window.addEventListener("message", receive)
      options.signal?.addEventListener("abort", abort, { once: true })
      if (options.signal?.aborted) abort()
      else popup.location.replace(url.href)
    })
  } finally {
    popup.close()
  }
}
