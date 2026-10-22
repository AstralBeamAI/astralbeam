import { WIDGET_CONTAINER_CLASS } from "../lib/constants.ts"
import { applyWidgetTheme } from "../lib/theme.ts"
import { waitWithSignal } from "../lib/abort.ts"
import type {
  TenantRecordEncoded as TenantRecord,
  TenantUserRecordEncoded as TenantUserRecord,
} from "../api/generated/api.ts"
import type { AstralBeamChatColorScheme, AstralBeamChatTheme } from "../lib/types.ts"
import type { ListingRenderer } from "../widget/listings/index.tsx"
import type { AstralBeamListingCoreOptions } from "../core/listings.ts"

export interface AstralBeamListingOptions extends AstralBeamListingCoreOptions {
  fetchAstralBeamToken: NonNullable<AstralBeamListingCoreOptions["fetchAstralBeamToken"]>
  /** Host-session boundary for remount reuse. Replacing it resets authentication and view state. */
  cacheKey?: object | undefined
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

export interface MountAstralBeamThreadListOptions extends AstralBeamListingOptions {
  onTenantChange?: ((tenant: TenantRecord | null) => void) | undefined
}

export type AstralBeamThreadListHandle = AstralBeamListingHandle<MountAstralBeamThreadListOptions>

export interface AstralBeamListingHandle<
  T extends AstralBeamListingOptions = AstralBeamListingOptions,
> {
  update(options: Partial<T>): void
  /** Waits for this mount's refreshed view, including lazy loading. May reuse valid authentication. */
  refresh(): Promise<void>
  /** Clears state, reacquires authentication, and waits for the initial view. Requires a ready host session. */
  reset(): Promise<void>
  unmount(): void
}

export type AstralBeamTenantListHandle = AstralBeamListingHandle<MountAstralBeamTenantListOptions>
export type AstralBeamTenantUserListHandle =
  AstralBeamListingHandle<MountAstralBeamTenantUserListOptions>

type ListingOptions = MountAstralBeamTenantListOptions & MountAstralBeamTenantUserListOptions
type ListingRuntime = typeof import("../widget/listings/index.tsx")
interface ListingMount {
  options: ListingOptions
  kind: "tenants" | "users" | "threads"
  shadow: ShadowRoot
  container: HTMLDivElement
  media: MediaQueryList
  variables: Set<string>
  disposed: boolean
  loading?: Promise<void> | undefined
  action?: AbortController | undefined
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

export function mountAstralBeamThreadList(
  target: HTMLElement,
  options: MountAstralBeamThreadListOptions,
): AstralBeamThreadListHandle {
  return mountListing(target, options, "threads")
}

function mountListing(
  target: HTMLElement,
  options: ListingOptions,
  kind: "tenants" | "users" | "threads",
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
  void loadListing(state).catch(() => {})
  return {
    update: (next) => updateListingMount(state, next),
    refresh: () => runListingAction(state, false),
    reset: () => runListingAction(state, true),
    unmount: () => unmountListing(state, theme),
  }
}

function applyListingTheme({ options, media, container, variables }: ListingMount) {
  applyWidgetTheme(container, variables, options, media.matches)
}

function loadListing(state: ListingMount): Promise<void> {
  return (state.loading ??= loadListingRenderer(state))
}

async function loadListingRenderer(state: ListingMount) {
  state.retryLoad?.remove()
  try {
    state.runtime = await import("../widget/listings/index.tsx")
    if (state.disposed) return
    state.renderer = state.runtime.renderListing(
      state.shadow,
      state.container,
      state.options,
      state.kind,
      () => runListingAction(state, false),
    )
  } catch (error) {
    state.loading = undefined
    if (state.disposed) throw error
    state.retryLoad = document.createElement("button")
    state.retryLoad.textContent = "Could not load directory. Retry"
    state.retryLoad.onclick = () => void loadListing(state).catch(() => {})
    state.container.append(state.retryLoad)
    throw error
  }
}

async function runListingAction(state: ListingMount, reset: boolean): Promise<void> {
  if (state.disposed) throw new DOMException("Directory unmounted", "AbortError")
  state.action?.abort()
  const action = new AbortController()
  state.action = action
  try {
    if (!state.renderer) await waitWithSignal(loadListing(state), action.signal)
    action.signal.throwIfAborted()
    await state.runtime!.refreshListing(state.renderer!, action.signal, reset)
  } finally {
    if (state.action === action) state.action = undefined
  }
}

function updateListingMount(state: ListingMount, next: Partial<ListingOptions>) {
  if (state.disposed) return
  const options = { ...state.options, ...next }
  if (
    options.apiUrl !== state.options.apiUrl ||
    options.cacheKey !== state.options.cacheKey ||
    options.scope !== state.options.scope ||
    options.tenantId !== state.options.tenantId ||
    options.tenantExternalId !== state.options.tenantExternalId
  )
    state.action?.abort()
  state.options = options
  applyListingTheme(state)
  if (state.renderer) state.runtime!.updateListing(state.renderer, state.options)
}

function unmountListing(state: ListingMount, theme: () => void) {
  if (state.disposed) return
  state.disposed = true
  state.action?.abort()
  state.media.removeEventListener("change", theme)
  if (state.renderer) state.runtime!.disposeListing(state.renderer)
  state.container.remove()
}
