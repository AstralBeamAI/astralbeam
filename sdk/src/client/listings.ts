import { WIDGET_CONTAINER_CLASS } from "../lib/constants.ts"
import { applyWidgetTheme } from "../lib/theme.ts"
import type {
  TenantRecordEncoded as TenantRecord,
  TenantUserRecordEncoded as TenantUserRecord,
} from "../api/generated/api.ts"
import type { AstralBeamChatColorScheme, AstralBeamChatTheme } from "../lib/types.ts"
import type { ListingRenderer } from "../widget/listings/index.tsx"
import type { AstralBeamListingCoreOptions } from "../core/listings.ts"

export interface AstralBeamListingOptions extends AstralBeamListingCoreOptions {
  fetchAstralBeamToken: NonNullable<AstralBeamListingCoreOptions["fetchAstralBeamToken"]>
  pageSize?: 20 | 50 | 100 | undefined
  title?: string | undefined
  showHeader?: boolean | undefined
  /** Trusted application CSS, scoped to this widget's shadow root. */
  customCss?: string | undefined
  colorScheme?: AstralBeamChatColorScheme | undefined
  theme?: AstralBeamChatTheme | undefined
}

export interface MountAstralBeamTenantListOptions extends AstralBeamListingOptions {
  onTenantSelect?: ((tenant: TenantRecord) => void) | undefined
}

export interface MountAstralBeamTenantUserListOptions extends AstralBeamListingOptions {
  /** Called when the Tenant picker selection changes. null means cleared. */
  onTenantChange?: ((tenant: TenantRecord | null) => void) | undefined
  /** Show the stored admin column and filter. Does not control authorization. Defaults to false. */
  showAdmin?: boolean | undefined
  onTenantUserSelect?: ((user: TenantUserRecord) => void) | undefined
}

export interface AstralBeamListingHandle<
  T extends AstralBeamListingOptions = AstralBeamListingOptions,
> {
  update(options: Partial<T>): void
  refresh(): void
  /** Clears state and reloads using the ready host session. Unmount during sign-out or account transitions. */
  reset(): void
  unmount(): void
}

export type AstralBeamTenantListHandle = AstralBeamListingHandle<MountAstralBeamTenantListOptions>
export type AstralBeamTenantUserListHandle =
  AstralBeamListingHandle<MountAstralBeamTenantUserListOptions>

type ListingOptions = MountAstralBeamTenantListOptions & MountAstralBeamTenantUserListOptions
type ListingRuntime = typeof import("../widget/listings/index.tsx")
interface ListingMount {
  options: ListingOptions
  kind: "tenants" | "users"
  shadow: ShadowRoot
  container: HTMLDivElement
  media: MediaQueryList
  variables: Set<string>
  disposed: boolean
  runtime?: ListingRuntime
  renderer?: ListingRenderer
  retryLoad?: HTMLButtonElement
}

export function mountAstralBeamTenantList(
  target: HTMLElement,
  options: MountAstralBeamTenantListOptions,
): AstralBeamTenantListHandle {
  return mountListing(target, options, "tenants")
}

export function mountAstralBeamTenantUserList(
  target: HTMLElement,
  options: MountAstralBeamTenantUserListOptions,
): AstralBeamTenantUserListHandle {
  return mountListing(target, options, "users")
}

function mountListing(
  target: HTMLElement,
  options: ListingOptions,
  kind: "tenants" | "users",
): AstralBeamListingHandle<ListingOptions> {
  const shadow = target.shadowRoot ?? target.attachShadow({ mode: "open" })
  const container = document.createElement("div")
  container.className = `${WIDGET_CONTAINER_CLASS} bg-transparent`
  container.style.height = "100%"
  shadow.append(container)
  const media = matchMedia("(prefers-color-scheme: dark)")
  const state: ListingMount = {
    options: { ...options },
    kind,
    shadow,
    container,
    media,
    variables: new Set(),
    disposed: false,
  }
  const theme = () => applyListingTheme(state)
  theme()
  media.addEventListener("change", theme)
  void loadListing(state)
  return {
    update: (next) => updateListingMount(state, next),
    refresh: () => {
      if (!state.disposed && state.renderer) state.runtime!.refreshListing(state.renderer)
    },
    reset: () => {
      if (!state.disposed && state.renderer) state.runtime!.resetListing(state.renderer)
    },
    unmount: () => unmountListing(state, theme),
  }
}

function applyListingTheme({ options, media, container, variables }: ListingMount) {
  applyWidgetTheme(container, variables, options, media.matches)
}

async function loadListing(state: ListingMount) {
  state.retryLoad?.remove()
  try {
    state.runtime = await import("../widget/listings/index.tsx")
    if (state.disposed) return
    state.renderer = state.runtime.renderListing(
      state.shadow,
      state.container,
      state.options,
      state.kind,
    )
  } catch {
    if (state.disposed) return
    state.retryLoad = document.createElement("button")
    state.retryLoad.textContent = "Could not load directory. Retry"
    state.retryLoad.onclick = () => void loadListing(state)
    state.container.append(state.retryLoad)
  }
}

function updateListingMount(state: ListingMount, next: Partial<ListingOptions>) {
  if (state.disposed) return
  state.options = { ...state.options, ...next }
  applyListingTheme(state)
  if (state.renderer) state.runtime!.updateListing(state.renderer, state.options)
}

function unmountListing(state: ListingMount, theme: () => void) {
  if (state.disposed) return
  state.disposed = true
  state.media.removeEventListener("change", theme)
  if (state.renderer) state.runtime!.disposeListing(state.renderer)
  state.container.remove()
}
