import type { DebugLogger } from "../lib/debug.ts"
import type { AstralBeamTokenSource } from "../lib/types.ts"

const REFRESH_SKEW_MS = 60_000
const MAX_TOKEN_LENGTH = 16_384

export type ChatAuthenticationState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; error: Error }

interface CachedToken {
  value: string
  expiresAt: number
}

interface ChatAuthenticationSession {
  cached: CachedToken | undefined
  refreshPromise: Promise<string> | undefined
  abortController: AbortController
}

export interface ChatAuthenticationOptions {
  /** The token endpoint to call or the host function to ask; callers resolve the default. */
  fetchAstralBeamToken: AstralBeamTokenSource
  session: ChatAuthenticationSession
  onStateChange: (state: ChatAuthenticationState) => void
  fetchClient: typeof globalThis.fetch
  debug: DebugLogger | undefined
}

interface GetValidChatAuthTokenOptions extends ChatAuthenticationOptions {
  force?: boolean
}

interface FetchAuthenticatedChatOptions extends ChatAuthenticationOptions {
  input: RequestInfo | URL
  init: RequestInit | undefined
}

function tokenExpiry(token: string): number {
  if (token.length > MAX_TOKEN_LENGTH) throw new Error("The chat auth token is too large")
  const parts = token.split(".")
  if (parts.length !== 3 || !parts[1]) throw new Error("The chat auth token is not a JWT")
  const encoded = parts[1].replaceAll("-", "+").replaceAll("_", "/")
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")
  let payload: unknown
  try {
    payload = JSON.parse(atob(padded))
  } catch {
    throw new Error("The chat auth token has an invalid payload")
  }
  const exp = (payload as { exp?: unknown } | null)?.exp
  if (!Number.isInteger(exp) || Number(exp) <= 0) {
    throw new Error("The chat auth token has no valid expiry")
  }
  return Number(exp) * 1_000
}

function bearerToken(headers: Headers): string | undefined {
  const authorization = headers.get("authorization")
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined
}

async function requestChatAuthToken(
  options: ChatAuthenticationOptions,
  signal: AbortSignal,
): Promise<unknown> {
  const { fetchAstralBeamToken, fetchClient } = options
  // No result at all means the host could not mint a token, which fails closed below.
  if (typeof fetchAstralBeamToken === "function") {
    const generated: { token?: unknown } | null | undefined = await fetchAstralBeamToken()
    return generated?.token
  }
  const { url, ...init } = fetchAstralBeamToken
  const headers = new Headers(init.headers)
  if (!headers.has("accept")) headers.set("accept", "application/json")
  const response = await fetchClient(url, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    // The host's own init wins, except that a token request must still abort with the session;
    // `AbortSignal.any` keeps a host-supplied signal working alongside it.
    ...init,
    headers,
    signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal,
  })
  if (!response.ok) throw new Error(`Authentication endpoint returned HTTP ${response.status}`)
  const body: unknown = await response.json()
  return (body as { token?: unknown } | null)?.token
}

async function loadChatAuthToken(options: ChatAuthenticationOptions): Promise<string> {
  const { session, onStateChange, debug } = options
  const { signal } = session.abortController
  const source = typeof options.fetchAstralBeamToken === "function"
    ? "fetchAstralBeamToken"
    : "Authentication endpoint"
  try {
    const token = await requestChatAuthToken(options, signal)
    if (typeof token !== "string" || !token) {
      throw new Error(`${source} did not return a token`)
    }
    const expiresAt = tokenExpiry(token)
    if (expiresAt <= Date.now()) {
      throw new Error(`${source} returned an expired token`)
    }
    session.cached = { value: token, expiresAt }
    onStateChange({ status: "ready" })
    debug?.("auth", "chat authentication ready", { expiresAt: new Date(expiresAt) })
    return token
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error("Chat authentication failed")
    if (!signal.aborted) {
      onStateChange({ status: "error", error })
      debug?.("error", `chat authentication failed: ${error.message}`)
    }
    throw error
  }
}

export async function getValidChatAuthToken(
  options: GetValidChatAuthTokenOptions,
): Promise<string> {
  const { session, force = false, onStateChange } = options
  const now = Date.now()
  if (!force && session.cached && session.cached.expiresAt - now > REFRESH_SKEW_MS) {
    return session.cached.value
  }
  if (session.refreshPromise) return await session.refreshPromise
  onStateChange({ status: "loading" })
  const refresh = loadChatAuthToken(options)
  session.refreshPromise = refresh
  try {
    return await refresh
  } finally {
    if (session.refreshPromise === refresh) session.refreshPromise = undefined
  }
}

export async function initializeChatAuthentication(
  options: ChatAuthenticationOptions,
): Promise<void> {
  if (options.session.abortController.signal.aborted) {
    options.session.abortController = new AbortController()
  }
  await getValidChatAuthToken(options)
}

export function disposeChatAuthentication(
  { session }: Pick<ChatAuthenticationOptions, "session">,
): void {
  session.abortController.abort()
  session.refreshPromise = undefined
}

export async function fetchAuthenticatedChat(
  options: FetchAuthenticatedChatOptions,
): Promise<Response> {
  const { input, init, session, fetchClient, debug } = options
  const response = await fetchClient(input, init)
  if (response.status !== 401 || session.abortController.signal.aborted) return response
  const usedToken = bearerToken(new Headers(init?.headers))
  const rejectedCurrentToken = !usedToken || session.cached?.value === usedToken
  if (rejectedCurrentToken) session.cached = undefined
  debug?.("auth", "chat auth token was rejected; refreshing once")
  const token = await getValidChatAuthToken({ ...options, force: rejectedCurrentToken })
  const headers = new Headers(init?.headers)
  headers.set("authorization", `Bearer ${token}`)
  await response.body?.cancel()
  return await fetchClient(input, { ...init, headers })
}
