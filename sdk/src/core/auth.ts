import { decodeJwt } from "jose"
import { type CurrentUser, getCurrentUser } from "../api/generated/api.ts"
import { isAstralBeamApiError } from "../api/api.ts"
import type { DebugLogger } from "../lib/debug.ts"
import type { AstralBeamTokenSource } from "../lib/types.ts"

const REFRESH_SKEW_MS = 60_000
const MAX_TOKEN_LENGTH = 16_384

export type ChatAuthenticationState =
  | { status: "loading" }
  | { status: "ready"; currentUser: CurrentUser }
  | { status: "error"; error: Error }

interface CachedToken {
  value: string
  refreshAt: number
  synchronizedAt: number
  tenantAdmin: boolean
}

interface ChatAuthenticationSession {
  cached: CachedToken | undefined
  refreshPromise: Promise<string> | undefined
  abortController: AbortController
  state: ChatAuthenticationState
  listeners: Set<() => void>
}

export interface ChatAuthenticationOptions {
  /** The token endpoint to call or the host function to ask; callers resolve the default. */
  fetchAstralBeamToken: AstralBeamTokenSource | undefined
  apiUrl?: string | undefined
  scope?: "tenant" | "organization" | undefined
  session: ChatAuthenticationSession
  fetchClient: typeof globalThis.fetch
  debug: DebugLogger | undefined
}

interface GetValidChatAuthTokenOptions extends ChatAuthenticationOptions {
  force?: boolean
  retryUnauthorized?: boolean
}

interface FetchAuthenticatedChatOptions extends ChatAuthenticationOptions {
  input: RequestInfo | URL
  init: RequestInit | undefined
}

function tokenTiming(token: string) {
  if (token.length > MAX_TOKEN_LENGTH) throw new Error("The chat auth token is too large")
  const { exp, iat, user } = decodeJwt<{ user?: { admin?: boolean } }>(token)
  if (!Number.isInteger(exp) || Number(exp) <= 0) {
    throw new Error("The chat auth token has no valid expiry")
  }
  const expiresAt = Number(exp) * 1_000
  const lifetime = iat === undefined ? 300_000 : expiresAt - iat * 1_000
  const margin = Math.min(REFRESH_SKEW_MS, lifetime * 0.2)
  const tenantAdmin = user?.admin === true
  return { expiresAt, refreshAt: expiresAt - margin, tenantAdmin }
}

async function requestChatAuthToken(
  options: ChatAuthenticationOptions,
  signal: AbortSignal,
): Promise<unknown> {
  const { fetchAstralBeamToken, fetchClient } = options
  if (typeof fetchAstralBeamToken === "function") {
    return (await fetchAstralBeamToken())?.token
  }
  if (!fetchAstralBeamToken) {
    throw new Error("Provide fetchAstralBeamToken.")
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
  if (!response.ok) {
    throw Object.assign(new Error(`Authentication endpoint returned HTTP ${response.status}`), {
      status: response.status,
      headers: response.headers,
    })
  }
  const body: unknown = await response.json()
  return (body as { token?: unknown } | null)?.token
}

const initialAuthenticationState: ChatAuthenticationState = { status: "loading" }

export function createChatAuthentication(options: {
  fetchAstralBeamToken?: AstralBeamTokenSource | undefined
  apiUrl?: string | undefined
  scope?: "tenant" | "organization" | undefined
}): ChatAuthenticationOptions {
  return {
    ...options,
    fetchAstralBeamToken: options.fetchAstralBeamToken,
    session: {
      cached: undefined,
      refreshPromise: undefined,
      abortController: new AbortController(),
      state: initialAuthenticationState,
      listeners: new Set(),
    },
    fetchClient: globalThis.fetch.bind(globalThis),
    debug: undefined,
  }
}

export function authenticationState(options: ChatAuthenticationOptions): ChatAuthenticationState {
  return options.session.state
}

export function subscribeAuthentication(options: ChatAuthenticationOptions, listener: () => void) {
  const { listeners } = options.session
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function publishAuthentication(options: ChatAuthenticationOptions, state: ChatAuthenticationState) {
  options.session.state = state
  for (const listener of options.session.listeners) listener()
}

export function updateAuthentication(
  options: ChatAuthenticationOptions,
  next: Pick<ChatAuthenticationOptions, "apiUrl" | "fetchAstralBeamToken">,
) {
  if (options.apiUrl !== next.apiUrl) {
    disposeChatAuthentication(options)
    options.session.abortController = new AbortController()
    publishAuthentication(options, { status: "loading" })
  }
  options.apiUrl = next.apiUrl
  options.fetchAstralBeamToken = next.fetchAstralBeamToken
}

export function authenticationIdentity(current: CurrentUser, tenantAdmin?: boolean): string {
  return JSON.stringify([
    current.scope,
    current.organization.id,
    current.scope === "tenant" ? current.tenant.id : null,
    current.user.id,
    tenantAdmin !== undefined
      ? (current.scope === "tenant" ? tenantAdmin : current.user.role)
      : null,
  ])
}

async function loadChatAuthToken(options: GetValidChatAuthTokenOptions): Promise<string> {
  const { session, debug, apiUrl } = options
  const { signal } = session.abortController
  const source = typeof options.fetchAstralBeamToken === "function"
    ? "fetchAstralBeamToken"
    : "Authentication endpoint"
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await requestChatAuthToken(options, signal)
      signal.throwIfAborted()
      if (typeof token !== "string" || !token) throw new Error(`${source} did not return a token`)
      const { expiresAt, refreshAt, tenantAdmin } = tokenTiming(token)
      if (expiresAt <= Date.now()) throw new Error(`${source} returned an expired token`)
      if (
        !Number.isFinite(refreshAt) || refreshAt <= Date.now() || expiresAt - Date.now() < 5_000
      ) {
        throw new Error(`${source} returned a token too close to expiry`)
      }
      let currentUser: CurrentUser
      try {
        currentUser = await getCurrentUser({}, {
          apiUrl,
          astralBeamToken: token,
          fetchClient: options.fetchClient,
          signal,
          cache: "no-store",
          credentials: "omit",
        })
      } catch (error) {
        if (
          !attempt && options.retryUnauthorized !== false && isAstralBeamApiError(error) &&
          error.status === 401
        ) continue
        throw error
      }
      signal.throwIfAborted()
      if (options.scope && options.scope !== currentUser.scope) {
        throw new Error(`Expected ${options.scope} authentication`)
      }
      session.cached = { value: token, refreshAt, synchronizedAt: Date.now(), tenantAdmin }
      publishAuthentication(options, { status: "ready", currentUser })
      debug?.("auth", "authentication ready", { expiresAt: new Date(expiresAt) })
      return token
    }
    throw new Error("Authentication failed")
  } catch (cause) {
    signal.throwIfAborted()
    const error = cause instanceof Error ? cause : new Error("Authentication failed")
    session.cached = undefined
    publishAuthentication(options, { status: "error", error })
    throw error
  }
}

export async function getValidChatAuthToken(
  options: GetValidChatAuthTokenOptions,
): Promise<string> {
  const { session, force = false } = options
  session.abortController.signal.throwIfAborted()
  if (session.refreshPromise) return await session.refreshPromise
  if (!force && session.cached && session.cached.refreshAt > Date.now()) return session.cached.value
  publishAuthentication(options, { status: "loading" })
  const refresh = loadChatAuthToken(options)
  session.refreshPromise = refresh
  try {
    return await refresh
  } finally {
    if (session.refreshPromise === refresh) session.refreshPromise = undefined
  }
}

export function refreshRejectedAuthentication(options: ChatAuthenticationOptions, token?: string) {
  const rejectedCurrentToken = !token || options.session.cached?.value === token
  if (rejectedCurrentToken) options.session.cached = undefined
  return getValidChatAuthToken({
    ...options,
    force: rejectedCurrentToken,
    retryUnauthorized: false,
  })
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
  session.cached = undefined
  session.state = initialAuthenticationState
}

export async function fetchAuthenticatedChat(
  options: FetchAuthenticatedChatOptions,
): Promise<Response> {
  const { input, init, session, fetchClient, debug } = options
  const response = await fetchClient(input, init)
  if (response.status !== 401 || session.abortController.signal.aborted) return response
  const headers = new Headers(init?.headers)
  const authorization = headers.get("authorization")
  const usedToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined
  debug?.("auth", "chat auth token was rejected; refreshing once")
  await response.body?.cancel()
  const previous = authenticationState(options)
  const token = await refreshRejectedAuthentication(options, usedToken)
  const current = authenticationState(options)
  if (
    previous.status === "ready" && current.status === "ready" &&
    authenticationIdentity(previous.currentUser) !== authenticationIdentity(current.currentUser)
  ) throw new DOMException("Identity changed", "AbortError")
  init?.signal?.throwIfAborted()
  headers.set("authorization", `Bearer ${token}`)
  return await fetchClient(input, { ...init, headers })
}
