import { startAuthentication } from "../../core/auth-lifecycle.ts"
import {
  authenticationIdentity,
  authenticationState,
  getValidChatAuthToken,
  subscribeAuthentication,
  updateAuthentication,
} from "../../core/auth.ts"
import { createRoot, type Root } from "react-dom/client"
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  MountAstralBeamTenantListOptions,
  MountAstralBeamTenantUserListOptions,
} from "../../client/listings.ts"
import { chatStyles } from "../styles.generated.ts"
import { disposeListingSession, type ListingSession, listingSession } from "../../core/listings.ts"
import { ListingWidget } from "./listing-widget.tsx"
import { waitWithSignal } from "../../lib/abort.ts"
import {
  claimListingQueryClient,
  clearListingCache,
  createListingQueryClient,
  retainListingQueryClient,
} from "./query-cache.ts"

type Options = MountAstralBeamTenantListOptions & MountAstralBeamTenantUserListOptions
export interface ListingRenderer {
  root: Root
  style: HTMLStyleElement
  client: QueryClient
  options: Options
  kind: "tenants" | "users" | "threads"
  stopAuthentication?: (() => void) | undefined
  unsubscribeAuthentication?: (() => void) | undefined
  revision: number
  session: ListingSession
  cacheIdentity?: string | undefined
  refresh: () => Promise<void>
  action?: PromiseWithResolvers<void> | undefined
}

export function renderListing(
  shadow: ShadowRoot,
  container: HTMLElement,
  options: Options,
  kind: "tenants" | "users" | "threads",
  refresh: () => Promise<void>,
): ListingRenderer {
  const style = document.createElement("style")
  style.textContent = chatStyles + (options.customCss ?? "")
  shadow.append(style)
  const root = createRoot(container)
  const client = createListingQueryClient()
  const state: ListingRenderer = {
    root,
    style,
    client,
    options,
    kind,
    refresh,
    revision: 0,
    session: listingSession(options, () => resetListing(state)),
  }
  watchListingAuthentication(state)
  renderListingState(state)
  return state
}

function renderListingState(state: ListingRenderer) {
  const auth = authenticationState(state.session.auth)
  const { action } = state
  state.root.render(
    <QueryClientProvider client={state.client}>
      {auth.status === "error" ? (
        <div role="alert" className="p-4 text-sm">
          <p>{auth.error.message}</p>
          <button
            type="button"
            className="underline"
            onClick={() => void state.refresh().catch(() => {})}
          >
            Retry authentication
          </button>
        </div>
      ) : auth.status === "loading" && state.cacheIdentity === undefined ? (
        <div role="status" aria-label="Loading directory" className="p-4 text-sm">
          Loading directory…
        </div>
      ) : (
        <ListingWidget
          key={state.revision}
          options={state.options}
          kind={state.kind}
          session={state.session}
          onRefresh={state.refresh}
          onComplete={action && ((error) => (error ? action.reject(error) : action.resolve()))}
        />
      )}
    </QueryClientProvider>,
  )
}

export async function refreshListing(
  state: ListingRenderer,
  actionSignal: AbortSignal,
  reset: boolean,
): Promise<void> {
  if (reset) resetListing(state)
  const signal = AbortSignal.any([actionSignal, state.session.abortController.signal])
  signal.throwIfAborted()
  await waitWithSignal(getValidChatAuthToken(state.session.auth), signal)
  signal.throwIfAborted()
  await state.client.cancelQueries()
  signal.throwIfAborted()
  // A request can fail authentication while cancellation settles.
  const auth = authenticationState(state.session.auth)
  if (auth.status === "error") throw auth.error
  const action = Promise.withResolvers<void>()
  state.action = action
  try {
    void state.client.invalidateQueries({ refetchType: "none" })
    const refetch = state.client.refetchQueries({ type: "active" }, { throwOnError: true })
    // The aggregate refetch promise skips paused queries. Their own promises wait for reconnect.
    const requests = state.client
      .getQueryCache()
      .findAll({ type: "active" })
      .map((query) => query.promise)
    renderListingState(state)
    await waitWithSignal(Promise.all([refetch, ...requests, action.promise]), signal)
  } finally {
    if (state.action === action) state.action = undefined
  }
}

function resetListing(state: ListingRenderer) {
  state.unsubscribeAuthentication?.()
  state.stopAuthentication?.()
  disposeListingSession(state.session)
  clearListingCache(state.options.cacheKey)
  state.client.clear()
  state.cacheIdentity = undefined
  state.session = listingSession(state.options, () => resetListing(state))
  state.revision++
  watchListingAuthentication(state)
  renderListingState(state)
}

export function updateListing(state: ListingRenderer, next: Options) {
  const previous = state.options
  if (previous.customCss !== next.customCss) {
    state.style.textContent = chatStyles + (next.customCss ?? "")
  }
  const changed = previous.apiUrl !== next.apiUrl || previous.cacheKey !== next.cacheKey
  state.options = next
  if (changed) {
    clearListingCache(previous.cacheKey)
    return resetListing(state)
  }
  state.session.options = next
  updateAuthentication(state.session.auth, {
    apiUrl: next.apiUrl,
    fetchAstralBeamToken: next.fetchAstralBeamToken,
  })
  if (
    previous.scope !== next.scope ||
    previous.tenantId !== next.tenantId ||
    previous.tenantExternalId !== next.tenantExternalId
  ) {
    state.client.clear()
    state.revision++
  }
  renderListingState(state)
}

export function disposeListing(state: ListingRenderer) {
  state.unsubscribeAuthentication?.()
  state.stopAuthentication?.()
  disposeListingSession(state.session)
  state.root.unmount()
  retainListingQueryClient(state.options, state.kind, state.cacheIdentity, state.client)
  state.style.remove()
}

function watchListingAuthentication(state: ListingRenderer) {
  state.unsubscribeAuthentication = subscribeAuthentication(state.session.auth, () => {
    const auth = authenticationState(state.session.auth)
    if (auth.status === "error") {
      state.action?.reject(auth.error)
      clearListingCache(state.options.cacheKey)
      state.client.clear()
      state.cacheIdentity = undefined
      state.revision++
    } else if (auth.status === "ready") {
      const next = JSON.stringify([
        state.options.apiUrl,
        authenticationIdentity(auth.currentUser, state.session.auth.session.cached!.tenantAdmin),
      ])
      if (state.cacheIdentity !== undefined && state.cacheIdentity !== next) {
        state.session.abortController.abort()
        state.session.abortController = new AbortController()
        state.session.identity = undefined
        state.client.clear()
        state.revision++
      }
      if (state.cacheIdentity !== next) {
        state.cacheIdentity = next
        state.client = claimListingQueryClient(state.options, state.kind, next)
      }
    }
    renderListingState(state)
  })
  state.stopAuthentication = startAuthentication(state.session.auth)
}
