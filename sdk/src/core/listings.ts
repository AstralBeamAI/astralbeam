import {
  type ChatAuthenticationOptions,
  disposeChatAuthentication,
  getValidChatAuthToken,
} from "./auth.ts"
import { isAstralBeamApiError, type JwtOptions } from "../api/api.ts"
import {
  getTenant,
  listTenants,
  type ListTenantsParams,
  listUsersForTenant,
  type TenantPage,
  type TenantUserPage,
} from "../api/generated/api.ts"
import { decodeJwt, decodeProtectedHeader } from "jose"
import type { AstralBeamTokenSource } from "../lib/types.ts"

export interface AstralBeamListingCoreOptions {
  apiUrl?: string | undefined
  fetchAstralBeamToken: AstralBeamTokenSource
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
}

export function listingSession(
  options: AstralBeamListingCoreOptions,
  onIdentityChange: () => void,
): ListingSession {
  return {
    options,
    onIdentityChange,
    auth: {
      fetchAstralBeamToken: options.fetchAstralBeamToken,
      session: {
        cached: undefined,
        refreshPromise: undefined,
        abortController: new AbortController(),
      },
      onStateChange: () => {},
      fetchClient: globalThis.fetch,
      debug: undefined,
    },
  }
}

export function disposeListingSession(session: ListingSession) {
  disposeChatAuthentication(session.auth)
}

export function resolveListingTenant(session: ListingSession, signal: AbortSignal) {
  return listingRequest(session, signal, async (auth) => {
    const { tenantId, tenantExternalId } = session.options
    if (tenantId !== undefined) return getTenant(tenantId, auth)
    const page = await listTenants({
      page_size: 1,
      ...(tenantExternalId !== undefined ? { "filter[external_id]": tenantExternalId } : {}),
    }, auth)
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
      return listUsersForTenant(tenantId, {
        ...params,
        ...(admin === "all" ? {} : { "filter[admin]": admin }),
      }, auth)
    }
    if (tenantId) {
      const row = await getTenant(tenantId, auth)
      const matches = !q ||
        [row.name ?? "", row.external_id].some((value) =>
          value.toLocaleLowerCase().includes(q.toLocaleLowerCase())
        )
      return { items: matches ? [row] : [], page_after: null, page_before: null }
    }
    return listTenants(params, auth)
  })
}

function tokenContext(token: string) {
  const { typ } = decodeProtectedHeader(token)
  const { iss, organization_id, email, tenant, user } = decodeJwt<{
    tenant?: { id?: string }
    user?: { id?: string; admin?: boolean }
  }>(token)
  return {
    organization: typ === "astralbeam-organization+jwt",
    identity: JSON.stringify([typ, iss, organization_id, email, tenant?.id, user?.id, user?.admin]),
  }
}

export function listingRequest<T>(
  session: ListingSession,
  signal: AbortSignal,
  request: (auth: JwtOptions) => Promise<T>,
): Promise<T> {
  const result = requestListing(session, signal, request)
  void result.catch((error: unknown) => {
    if (
      !signal.aborted && !session.auth.session.abortController.signal.aborted &&
      !(error instanceof Error && error.name === "AbortError")
    ) {
      try {
        session.options.onError?.(error instanceof Error ? error : new Error(String(error)))
      } catch {
        // Preserve the request failure even if a host callback throws.
      }
    }
  })
  return result
}

async function requestListing<T>(
  session: ListingSession,
  signal: AbortSignal,
  request: (auth: JwtOptions) => Promise<T>,
): Promise<T> {
  const combined = AbortSignal.any([signal, session.auth.session.abortController.signal])
  for (let attempt = 0; attempt < 2; attempt++) {
    combined.throwIfAborted()
    session.auth.fetchAstralBeamToken = session.options.fetchAstralBeamToken
    const token = await getValidChatAuthToken(session.auth)
    combined.throwIfAborted()
    // Decoding is only a UI hint. Authorization: https://app.astralbeam.ai/docs/sdk/api
    const context = tokenContext(token)
    if (session.identity !== undefined && session.identity !== context.identity) {
      session.onIdentityChange()
      throw new DOMException("Identity changed", "AbortError")
    }
    session.identity = context.identity
    if (session.options.scope === "organization" && !context.organization) {
      throw new Error("Organization mode requires an organization-management token.")
    }
    if (
      (session.options.scope ?? "tenant") === "tenant" && context.organization &&
      !session.options.tenantId && session.options.tenantExternalId === undefined
    ) {
      throw new Error(
        "tenantId or tenantExternalId is required for a tenant view using an organization token.",
      )
    }
    try {
      const result = await request({
        apiUrl: session.options.apiUrl,
        astralBeamToken: token,
        signal: combined,
      })
      combined.throwIfAborted()
      return result
    } catch (error) {
      if (attempt || !isAstralBeamApiError(error) || error.status !== 401) throw error
      if (session.auth.session.cached?.value === token) session.auth.session.cached = undefined
    }
  }
  throw new Error("Authentication failed")
}
