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
  style.textContent = chatStyles
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
  renderListingState(state)
  return state
}

function renderListingState(state: ListingRenderer) {
  state.root.render(
    <QueryClientProvider client={state.client}>
      <ListingWidget
        key={state.revision}
        options={state.options}
        kind={state.kind}
        session={state.session}
      />
    </QueryClientProvider>,
  )
}

export function resetListing(state: ListingRenderer) {
  disposeListingSession(state.session)
  state.client.clear()
  state.session = listingSession(state.options, () => resetListing(state))
  state.revision++
  renderListingState(state)
}

export function updateListing(state: ListingRenderer, next: Options) {
  const previous = state.options
  const changed = previous.apiUrl !== next.apiUrl
  state.options = next
  if (changed) return resetListing(state)
  state.session.options = next
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
  disposeListingSession(state.session)
  state.client.clear()
  state.root.unmount()
  state.style.remove()
}
