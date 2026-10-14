import { isAstralBeamApiError } from "../api/api.ts"

export interface McpAuthorizationAttempt {
  organizationId: string
  tenantId: string
  connectionId: string
  id: string
}

/** Open from a user gesture. The popup never receives the caller's authentication token. */
export async function runMcpAuthorization(options: {
  start: () => Promise<{ attempt: McpAuthorizationAttempt; popupUrl: string }>
  bind: (attempt: McpAuthorizationAttempt, challenge: string) => Promise<void>
  complete: (attempt: McpAuthorizationAttempt) => Promise<boolean>
  signal?: AbortSignal | undefined
}): Promise<void> {
  const popup = window.open("about:blank", "_blank", "popup,width=600,height=720")
  if (!popup) throw new Error("Allow popups to connect your account.")
  try {
    const started = await options.start()
    const url = new URL(started.popupUrl)
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
        } | null
        if (
          !data?.attempt ||
          data.attempt.id !== started.attempt.id ||
          data.attempt.organizationId !== started.attempt.organizationId ||
          data.attempt.tenantId !== started.attempt.tenantId ||
          data.attempt.connectionId !== started.attempt.connectionId
        )
          return
        if (
          data.type === "mcp-browser-challenge" &&
          !binding &&
          typeof data.challenge === "string"
        ) {
          binding = options.bind(started.attempt, data.challenge)
          void binding.catch(fail)
        }
      }
      const poll = setInterval(() => {
        if (completing || finished) return
        if (popup.closed) return fail(new Error("Authorization window closed."))
        if (!binding) return
        completing = true
        void binding
          .then(() => (finished ? false : options.complete(started.attempt)))
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
              if (
                !(error instanceof TypeError) &&
                !(isAstralBeamApiError(error) && (error.status === 429 || error.status >= 500))
              )
                fail(error)
            },
          )
      }, 5_000)
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
