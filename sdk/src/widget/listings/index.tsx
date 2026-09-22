import { startAuthentication } from "../../core/auth-lifecycle.ts"
import {
  authenticationIdentity,
  authenticationState,
  getValidChatAuthToken,
  subscribeAuthentication,
  updateAuthentication,
} from "../../core/auth.ts"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type {
  MountAstralBeamTenantListOptions,
  MountAstralBeamTenantUserListOptions,
} from "../../client/listings.ts"
import { chatStyles } from "../styles.generated.ts"
import { disposeListingSession, type ListingSession, listingSession } from "../../core/listings.ts"
import { ListingWidget } from "./listing-widget.tsx"

type Options = MountAstralBeamTenantListOptions & MountAstralBeamTenantUserListOptions
export interface ListingRenderer {
  root: Root
  style: HTMLStyleElement
  client: QueryClient
  options: Options
  kind: "tenants" | "users"
  stopAuthentication?: (() => void) | undefined
  unsubscribeAuthentication?: (() => void) | undefined
  revision: number
  session: ListingSession
}

export function renderListing(
  shadow: ShadowRoot,
  container: HTMLElement,
  options: Options,
  kind: "tenants" | "users",
): ListingRenderer {
  const style = document.createElement("style")
  style.textContent = chatStyles + (options.customCss ?? "")
  shadow.append(style)
  const root = createRoot(container)
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, gcTime: 0 },
    },
  })
  const state: ListingRenderer = {
    root,
    style,
    client,
    options,
    kind,
    revision: 0,
    session: listingSession(options, () => resetListing(state)),
  }
  watchListingAuthentication(state)
  renderListingState(state)
  return state
}

function renderListingState(state: ListingRenderer) {
  const auth = authenticationState(state.session.auth)
  state.root.render(
    <QueryClientProvider client={state.client}>
      {auth.status === "error"
        ? (
          <div role="alert" className="p-4 text-sm">
            <p>{auth.error.message}</p>
            <button
              type="button"
              className="underline"
              onClick={() => refreshListing(state)}
            >
              Retry authentication
            </button>
          </div>
        )
        : (
          <ListingWidget
            key={state.revision}
            options={state.options}
            kind={state.kind}
            session={state.session}
          />
        )}
    </QueryClientProvider>,
  )
}

export function refreshListing(state: ListingRenderer) {
  if (authenticationState(state.session.auth).status === "error") {
    void getValidChatAuthToken({ ...state.session.auth, force: true }).catch(() => {})
  } else {
    void state.client.invalidateQueries()
  }
}

export function resetListing(state: ListingRenderer) {
  state.unsubscribeAuthentication?.()
  state.stopAuthentication?.()
  disposeListingSession(state.session)
  state.client.clear()
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
  const changed = previous.apiUrl !== next.apiUrl
  state.options = next
  if (changed) return resetListing(state)
  state.session.options = next
  updateAuthentication(state.session.auth, {
    apiUrl: next.apiUrl,
    fetchAstralBeamToken: next.fetchAstralBeamToken,
  })
  if (
    previous.scope !== next.scope || previous.tenantId !== next.tenantId ||
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
  state.client.clear()
  state.root.unmount()
  state.style.remove()
}

function watchListingAuthentication(state: ListingRenderer) {
  let identity: string | undefined
  state.unsubscribeAuthentication = subscribeAuthentication(state.session.auth, () => {
    const auth = authenticationState(state.session.auth)
    if (auth.status === "error") {
      state.client.clear()
      state.revision++
    } else if (auth.status === "ready") {
      const next = authenticationIdentity(
        auth.currentUser,
        state.session.auth.session.cached!.tenantAdmin,
      )
      if (identity !== undefined && identity !== next) {
        state.session.abortController.abort()
        state.session.abortController = new AbortController()
        state.session.identity = undefined
        state.client.clear()
        state.revision++
      }
      identity = next
    }
    renderListingState(state)
  })
  state.stopAuthentication = startAuthentication(state.session.auth)
}
