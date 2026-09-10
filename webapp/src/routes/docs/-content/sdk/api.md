# API client

Use `@astralbeam/sdk/api` to manage Tenants and TenantUsers from your server or an authorized browser session. The same helpers work in both environments.

| Use case                  | Credential                         | Resource access                                     |
| ------------------------- | ---------------------------------- | --------------------------------------------------- |
| Backend provisioning      | Organization API key               | Read and write throughout its Organization          |
| Employee management UI    | Organization JWT                   | Owners/developers read and write; viewers read only |
| Customer administrator UI | Tenant JWT with `user.admin: true` | Read its Tenant; read and write its TenantUsers     |
| End-user chat             | Tenant JWT                         | Chat only, unless signed admin is true              |

Organization JWT users must already be AstralBeam organization members. TenantUsers are your customers' users and do not need dashboard accounts. Neither token provisions Tenant or TenantUser records.

## Server: organization API key

Keep the full organization API key on your server. The `apiKey` option sends it as `X-API-Key`.

```ts
import { createTenant, listTenants, updateTenant } from "@astralbeam/sdk/api"

const options = { apiKey: process.env.ASTRALBEAM_API_KEY! }
const tenant = await createTenant({ external_id: "acme", name: "Acme" }, options)
await updateTenant(tenant.id, { name: "Acme Inc." }, options)

const first = await listTenants({ page_size: 20 }, options)
if (first.page_after) {
  const second = await listTenants({ page_after: first.page_after }, options)
  // Pass second.page_before to page_before to return toward the first page.
}
```

API records use internal IDs. Token-facing user and tenant IDs remain your application's external identifiers. Fields match the REST API, including `external_id`, `created_at`, and `page_after`. Timestamps are strings.

## Browser: organization JWT

Create an authenticated endpoint in your application. This example path, `/api/astralbeam/organization-token`, is host-owned, not an AstralBeam endpoint. Keep it separate from your tenant chat token endpoint.

```ts
import { createAstralBeamOrganizationToken } from "@astralbeam/sdk/server"

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" }
  const session = await getApplicationSession(request)
  if (!session) return Response.json({ error: "Unauthenticated" }, { status: 401, headers })
  const apiKey = process.env.ASTRALBEAM_API_KEY
  const organizationId = process.env.ASTRALBEAM_ORGANIZATION_ID
  if (!apiKey || !organizationId) {
    return Response.json({ error: "Not configured" }, { status: 503, headers })
  }
  try {
    const token = await createAstralBeamOrganizationToken({
      apiKey,
      organizationId,
      email: session.user.email,
    })
    return Response.json({ token }, { headers })
  } catch {
    return Response.json({ error: "Token could not be issued" }, { status: 500, headers })
  }
}
```

`getApplicationSession` represents your server's existing authentication. Derive a verified email from it, never the request body. Use your framework's session/CSRF protections and restrict the endpoint to your intended employee audience.

Set `ASTRALBEAM_ORGANIZATION_ID` to the Organization UUID embedded in your full API key (`key_<organizationId>_<keyId>_abo_<secret>`). It is neither the organization slug nor a Tenant ID. These environment variable names are your host application's configuration, not required SDK configuration.

```ts
import { listTenants, listUsersForTenant } from "@astralbeam/sdk/api"

const response = await fetch("/api/astralbeam/organization-token", {
  method: "POST",
  credentials: "same-origin",
  cache: "no-store",
})
if (!response.ok) throw new Error(`Token endpoint returned ${response.status}`)
const { token } = await response.json()
if (typeof token !== "string" || !token) throw new Error("Missing token")
const options = { astralBeamToken: token }
const filters = { q: "Acme", page_size: 20 }
const first = await listTenants(filters, options)
if (first.page_after) {
  const second = await listTenants({ ...filters, page_after: first.page_after }, options)
}
if (first.items[0]) {
  const users = await listUsersForTenant(first.items[0].id, {
    q: "Alex",
    "filter[admin]": "false",
    page_size: 20,
  }, options)
}
```

Keep tokens in memory. The helper signs locally; successful minting does not prove membership or permission. Roles are not encoded in tokens: each API request checks current database membership and roles. A role downgrade applies on the next request without waiting for token expiry. Organization tokens cannot authenticate chat or dashboard administration.

## Browser: tenant JWT

Obtain a short-lived token from your application's authenticated token endpoint, never expose an organization API key in browser code. The `astralBeamToken` option sends `Authorization: Bearer`.

```ts
import { listTenants, listUsersForTenant } from "@astralbeam/sdk/api"

const response = await fetch("/api/astralbeam/token", { method: "POST", cache: "no-store" })
if (!response.ok) throw new Error(`Token endpoint returned ${response.status}`)
const { token } = await response.json()
if (typeof token !== "string" || !token) throw new Error("Missing token")
const options = { astralBeamToken: token }
const page = await listTenants({}, options)
const tenant = page.items[0]
if (tenant) {
  const users = await listUsersForTenant(tenant.id, { page_size: 20 }, options)
}
```

Tenant JWT resource calls require signed `user.admin: true` and are restricted to that Tenant. Tenant JWT callers cannot create or update Tenants. Ordinary tenant users can use chat but cannot manage these resources. Stored TenantUser admin values do not change an already-issued token's authority.

## Filtering, updates, and errors

- Filter lists with `{ "filter[external_id]": "acme" }`. Matching is exact and case-sensitive.
- Use `q` for literal, case-insensitive name/external-ID search. TenantUser lists also accept `"filter[admin]": "true"` or `"false"`. Filters combine with AND.
- Preserve all filters while paging. Clear both cursors when changing search, filters, organization, or Tenant.
- Pass either `page_after` or `page_before`, not both. A null continuation means there is no page in that direction. Listings are live, not snapshots.
- PATCH sends only the fields supplied. `name: null` clears a name. Metadata replaces the whole object, and `{}` clears it.
- Set `apiUrl` to your deployment's `/api` base and use `signal` to cancel a request.
- Requests follow redirects by default and do not retry automatically. Use trusted API URLs and redirect destinations. A failed or aborted mutation may already have committed. Low-level JWT calls do not refresh tokens automatically.

```ts
import { isAstralBeamApiError, updateTenant } from "@astralbeam/sdk/api"

try {
  await updateTenant(tenantId, { metadata: {} }, { apiKey })
} catch (error) {
  if (isAstralBeamApiError(error)) {
    console.error(error.status, error.body?.detail, error.body?.issues)
    // Available even when a gateway returns HTML instead of an API error:
    const retryAfter = error.headers.get("Retry-After")
  } else {
    throw error
  }
}
```

## Token expiry and recovery

The API helpers accept a token string and do not maintain a session. Tokens default to five minutes. Your token endpoint must reauthenticate every renewal; a renewal is not permission to extend an expired host session.

- On an API `401`, obtain a fresh token and retry a read once. If renewal fails or the retry returns `401`, stop and ask the user to sign in or check configuration.
- On `403`, do not loop on renewal. Check current organization membership/role, or the tenant JWT's signed admin claim.
- On `429`, respect `Retry-After`. Do not use new tokens to bypass the limit.
- On `400`, inspect query issues. A rejected cursor requires restarting the listing without it. On `422`, correct the submitted fields.
- On create `409` or an uncertain write outcome, look up the exact external ID and inspect the result before deciding to retry. Do not blindly replay mutations.
- Cancel pending reads with `signal` when switching identity or scope, and clear old rows and cursors. Responses fetched for the previous identity must not update the new view.

## Chat and downloads

Use the [headless chat SDK](./headless) for event parsing, tools, cancellation, and token refresh. For direct HTTP access, `getChatConfig` returns JSON, while `runChat` and `getChatFile` return native, unread `Response` objects.

```ts
import { getChatConfig, getChatFile, runChat } from "@astralbeam/sdk/api"

const config = await getChatConfig({ agentId }, { astralBeamToken: token })
const response = await runChat(agUiRequest, { astralBeamToken: token, signal })
// Consume response.body as an SSE stream. No events are buffered by the helper.

const file = await getChatFile({ ticket })
const filename = file.headers.get("Content-Disposition")
const bytes = await file.arrayBuffer()
```

Chat accepts tenant JWTs without requiring admin privileges. Downloads use their signed ticket, not an API key or JWT. See the [API reference](/docs/api) for all operations, permissions, and response schemas.
