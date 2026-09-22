import {
  authenticationState,
  type ChatAuthenticationOptions,
  getValidChatAuthToken,
  initializeChatAuthentication,
  subscribeAuthentication,
} from "./auth.ts"

export function startAuthentication(options: ChatAuthenticationOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const events = new AbortController()
  let retries = 0
  const visible = () =>
    typeof document === "undefined" ||
    (document.visibilityState !== "hidden" && globalThis.navigator?.onLine !== false)
  const refresh = () => {
    if (events.signal.aborted || !visible()) return
    void getValidChatAuthToken({ ...options, force: true }).catch(() => {})
  }
  const schedule = () => {
    clearTimeout(timer)
    if (events.signal.aborted || typeof document === "undefined" || !visible()) return
    const state = authenticationState(options)
    if (state.status === "ready") {
      retries = 0
      timer = setTimeout(refresh, Math.max(1_000, options.session.cached!.refreshAt - Date.now()))
    } else if (state.status === "error" && retries < 3) {
      const error = state.error as Error & { status?: number; headers?: Headers }
      if (error.status !== undefined && error.status !== 429 && error.status < 500) return
      if (error.status === undefined && !(error instanceof TypeError)) return
      const retryAfter = error.headers?.get("retry-after")
      const delay = retryAfter
        ? (/^\d+$/.test(retryAfter)
          ? Number(retryAfter) * 1_000
          : Date.parse(retryAfter) - Date.now())
        : 0
      timer = setTimeout(
        refresh,
        Math.max(1_000 * 2 ** retries++, Number.isFinite(delay) ? delay : 0),
      )
    }
  }
  const foreground = () => {
    if (!visible()) {
      clearTimeout(timer)
      return
    }
    const cached = options.session.cached
    if (!cached || Date.now() - cached.synchronizedAt >= 60_000 || cached.refreshAt <= Date.now()) {
      refresh()
    } else schedule()
  }
  const unsubscribe = subscribeAuthentication(options, schedule)
  if (typeof document !== "undefined") {
    for (const event of ["focus", "online", "offline"]) {
      globalThis.addEventListener(event, foreground, { signal: events.signal })
    }
    document.addEventListener("visibilitychange", foreground, { signal: events.signal })
  }
  void initializeChatAuthentication(options).catch(() => {})
  schedule()
  return () => {
    events.abort()
    clearTimeout(timer)
    unsubscribe()
  }
}
