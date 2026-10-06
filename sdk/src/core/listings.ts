import {
  authenticationIdentity,
  authenticationState,
  type ChatAuthenticationOptions,
  createChatAuthentication,
  disposeChatAuthentication,
  getValidChatAuthToken,
  refreshRejectedAuthentication,
  subscribeAuthentication,
  updateAuthentication,
} from "./auth.ts"
import { isAstralBeamApiError, type JwtOptions } from "../api/api.ts"
import {
  listThreads,
  listThreadMessages,
  getThreadAttachment,
  getTenant,
  listTenants,
  type ListTenantsParams,
  listUsersForTenant,
  type TenantPage,
  type TenantUserPage,
} from "../api/generated/api.ts"
import type { AstralBeamTokenSource } from "../lib/types.ts"

export interface AstralBeamListingCoreOptions {
  apiUrl?: string | undefined
  fetchAstralBeamToken?: AstralBeamTokenSource | undefined
  /** Tenant is the safe default. Organization mode requires an organization-management JWT. */
  scope?: "tenant" | "organization" | undefined
  /** Internal UUID. Supply this or tenantExternalId for tenant mode with an organization JWT. */
  tenantId?: string | undefined
  /** Exact customer-owned Tenant ID. tenantId takes precedence when both are supplied. */
  tenantExternalId?: string | undefined
  /** Final request failures, after authentication retry. Cancellations are not reported. */
  onError?: ((error: Error) => void) | undefined
}

export interface ListingSession {
  auth: ChatAuthenticationOptions
  identity?: string | undefined
  options: AstralBeamListingCoreOptions
  onIdentityChange: () => void
  abortController: AbortController
}

export function listingSession(
  options: AstralBeamListingCoreOptions,
  onIdentityChange: () => void,
): ListingSession {
  const session: ListingSession = {
    options,
    onIdentityChange,
    abortController: new AbortController(),
    auth: createChatAuthentication({
      apiUrl: options.apiUrl,
      fetchAstralBeamToken: options.fetchAstralBeamToken,
    }),
  }
  subscribeAuthentication(session.auth, () => {
    const state = authenticationState(session.auth)
    if (state.status === "error") reportListingError(session, state.error)
  })
  return session
}

function reportListingError(session: ListingSession, error: unknown) {
  try {
    session.options.onError?.(error instanceof Error ? error : new Error(String(error)))
  } catch {
    // Preserve authentication and request state even if a host callback throws.
  }
}

export function disposeListingSession(session: ListingSession) {
  session.abortController.abort()
  disposeChatAuthentication(session.auth)
}

export function resolveListingTenant(session: ListingSession, signal: AbortSignal) {
  return listingRequest(session, signal, async (auth) => {
    const { tenantId, tenantExternalId } = session.options
    if (tenantId !== undefined) return getTenant(tenantId, auth)
    const page = await listTenants(
      {
        page_size: 1,
        ...(tenantExternalId !== undefined ? { "filter[external_id]": tenantExternalId } : {}),
      },
      auth,
    )
    return page.items[0] ?? null
  })
}

export function loadTenantChoices(
  session: ListingSession,
  params: ListTenantsParams,
  signal: AbortSignal,
) {
  return listingRequest(session, signal, (auth) => listTenants(params, auth))
}

export interface ListingPageOptions {
  kind: "tenants" | "users"
  tenantId: string | undefined
  q: string
  admin: "all" | "true" | "false"
  size: number
  cursor: { page_after?: string; page_before?: string }
}

export function loadListingPage(
  session: ListingSession,
  page: ListingPageOptions,
  signal: AbortSignal,
): Promise<TenantPage | TenantUserPage> {
  return listingRequest(session, signal, async (auth) => {
    const { kind, tenantId, q, admin, size, cursor } = page
    const params = { q, page_size: size, ...cursor }
    if (kind === "users") {
      if (!tenantId) throw new Error("Select a tenant before listing its users.")
      return listUsersForTenant(
        tenantId,
        {
          ...params,
          ...(admin === "all" ? {} : { "filter[admin]": admin }),
        },
        auth,
      )
    }
    if (tenantId) {
      const row = await getTenant(tenantId, auth)
      const matches =
        !q ||
        [row.name ?? "", row.external_id].some((value) =>
          value.toLocaleLowerCase().includes(q.toLocaleLowerCase()),
        )
      return { items: matches ? [row] : [], page_after: null, page_before: null }
    }
    return listTenants(params, auth)
  })
}

export async function listingRequest<T>(
  session: ListingSession,
  signal: AbortSignal,
  request: (auth: JwtOptions) => Promise<T>,
): Promise<T> {
  const combined = AbortSignal.any([
    signal,
    session.abortController.signal,
    session.auth.session.abortController.signal,
  ])
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      combined.throwIfAborted()
      updateAuthentication(session.auth, {
        apiUrl: session.options.apiUrl,
        fetchAstralBeamToken: session.options.fetchAstralBeamToken,
      })
      const token = await getValidChatAuthToken({
        ...session.auth,
        retryUnauthorized: attempt === 0,
      })
      combined.throwIfAborted()
      const state = authenticationState(session.auth)
      if (state.status !== "ready") throw new Error("Authentication is not ready")
      const organization = state.currentUser.scope === "organization"
      const identity = authenticationIdentity(
        state.currentUser,
        session.auth.session.cached!.tenantAdmin,
      )
      if (session.identity !== undefined && session.identity !== identity) {
        session.onIdentityChange()
        throw new DOMException("Identity changed", "AbortError")
      }
      session.identity = identity
      if (session.options.scope === "organization" && !organization) {
        throw new Error("Organization mode requires an organization-management token.")
      }
      if (
        (session.options.scope ?? "tenant") === "tenant" &&
        organization &&
        !session.options.tenantId &&
        session.options.tenantExternalId === undefined
      ) {
        throw new Error(
          "tenantId or tenantExternalId is required for a tenant view using an organization token.",
        )
      }
      try {
        const result = await request({
          apiUrl: session.auth.apiUrl,
          astralBeamToken: token,
          signal: combined,
        })
        combined.throwIfAborted()
        return result
      } catch (error) {
        if (attempt || !isAstralBeamApiError(error) || error.status !== 401) throw error
        await refreshRejectedAuthentication(session.auth, token)
      }
    }
    throw new Error("Authentication failed")
  } catch (error) {
    const auth = authenticationState(session.auth)
    if (
      !(auth.status === "error" && auth.error === error) &&
      !combined.aborted &&
      !(error instanceof Error && error.name === "AbortError")
    ) {
      reportListingError(session, error)
    }
    throw error
  }
}

export function loadThreadDirectory(
  session: ListingSession,
  page: Omit<ListingPageOptions, "kind" | "admin">,
  signal: AbortSignal,
) {
  return listingRequest(session, signal, (auth) =>
    listThreads(
      {
        q: page.q,
        page_size: page.size,
        ...page.cursor,
        ...(page.tenantId ? { "filter[tenant_id]": page.tenantId } : {}),
      },
      auth,
    ),
  )
}

export function loadDirectoryThreadHistory(
  session: ListingSession,
  tenantId: string,
  id: string,
  pageAfter: string | undefined,
  signal: AbortSignal,
) {
  return listingRequest(session, signal, (auth) =>
    listThreadMessages(
      tenantId,
      id,
      {
        page_size: 100,
        ...(pageAfter ? { page_after: pageAfter } : {}),
      },
      auth,
    ),
  )
}

export function loadDirectoryThreadAttachment(
  session: ListingSession,
  tenantId: string,
  id: string,
  messageId: string,
  partId: string,
  signal: AbortSignal,
) {
  return listingRequest(session, signal, async (auth) => {
    const response = await getThreadAttachment(tenantId, id, messageId, partId, auth)
    return response.blob()
  })
}
