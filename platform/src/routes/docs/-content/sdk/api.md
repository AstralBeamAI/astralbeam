# API client

Manage Tenants and TenantUsers with `@astralbeam/sdk/api`. Use an API key on your server or a short-lived, scoped JWT in the browser.

| Use case | Credential | Resource access |
| --- | --- | --- |
| Backend provisioning | Organization API key | Read and write throughout its Organization |
| Customer administrator UI | Tenant JWT with `user.admin: true` | Read its Tenant; read and write its TenantUsers |
| Internal employee UI | Organization-management JWT | Current member permissions across the Organization |
| End-user chat | Tenant JWT | Chat and own identity synchronization. Directories require signed admin |

TenantUsers do not need dashboard accounts. Token minting alone creates no records. SDK sessions synchronize signed identity before loading data. Direct API clients call `getCurrentUser` or provision records through the management API.

## Server: organization API key

Keep the full organization API key on your server. The `apiKey` option sends it as `X-API-Key`.

```ts
import { createTenant, listTenants, updateTenant } from "@astralbeam/sdk/api"

const options = { apiKey: process.env.ASTRALBEAM_API_KEY! }
const tenant = await createTenant({ external_id: "acme", name: "Acme" }, options)
await updateTenant(tenant.id, { name: "Acme Inc." }, options)

const first = await listTenants({}, options)
if (first.page_after) {
  const second = await listTenants({ page_after: first.page_after }, options)
  // Pass second.page_before to page_before to return toward the first page.
}
```

Use returned internal IDs in API resource paths and your application's external IDs in tokens. Fields follow the REST API's snake_case names. Timestamps are strings.

## Current user

Call `getCurrentUser` after obtaining a JWT:

```ts
import { getCurrentUser } from "@astralbeam/sdk/api"

const currentUser = await getCurrentUser({ astralBeamToken: token })
```

Ordinary tenant JWTs can synchronize their own Tenant and TenantUser. Organization JWTs return existing membership, including viewers, without provisioning. SDK components call this automatically after every token acquisition. See [authentication](./authentication.md).

## Browser: tenant JWT

Obtain a short-lived token from your application's authenticated token endpoint, never expose an organization API key in browser code. The `astralBeamToken` option sends `Authorization: Bearer`.

```ts
import { listTenants, listUsersForTenant } from "@astralbeam/sdk/api"

const response = await fetch("/api/astralbeam/token", { method: "POST" })
const { token } = await response.json()
const options = { astralBeamToken: token }
const page = await listTenants({}, options)
const tenant = page.items[0]
if (tenant) {
  const users = await listUsersForTenant(tenant.id, {}, options)
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
- API-key requests reject redirects. JWT requests follow Fetch defaults unless overridden. Requests do not retry automatically. Use trusted API URLs and redirect destinations. A failed or aborted mutation may already have committed. Low-level JWT calls do not refresh tokens automatically.

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

Use the [headless chat SDK](./headless.md) for event parsing, tools, cancellation, and token refresh. For direct HTTP access, `getChatConfig` returns JSON, while `runChat` and `getThreadAttachment` return native, unread `Response` objects.

```ts
import { getChatConfig, getThreadAttachment, runChat } from "@astralbeam/sdk/api"

const config = await getChatConfig({ agentId }, { astralBeamToken: token })
const response = await runChat(agUiRequest, { astralBeamToken: token, signal })
// New runs stream SSE. An accepted idempotent retry returns a JSON receipt.

const file = await getThreadAttachment(
  { threadId, fileId, filename: "report.csv" },
  { astralBeamToken: token },
)
const filename = file.headers.get("Content-Disposition")
const bytes = await file.arrayBuffer()
```

`agUiRequest` must follow `ChatRunInput`: use a saved conversation UUID, one new user message, and `forwardedProps.clientId`. The headless SDK handles this setup and the SSE or admission-receipt response automatically.

Chat accepts tenant JWTs without requiring admin privileges. Participant downloads require current conversation access. Administrative downloads also pass `tenantId` and accept an Organization API key, Organization-management JWT, or signed Tenant-admin JWT. See the [API reference](/docs/api) for all operations, permissions, and response schemas.

## Browser: organization JWT

Use this for internal employee tools. The user must already be an organization member. Each request checks their current role: owners and developers can read and write, viewers can read. The issuing API key retains organization-wide authority.

In an authenticated server handler, mint a token for the verified member's email and authorized Organization UUID:

```ts
import { createAstralBeamOrganizationToken } from "@astralbeam/sdk/server"

const token = await createAstralBeamOrganizationToken({
  apiKey: process.env.ASTRALBEAM_API_KEY!,
  organizationId: organization.id,
  email: session.user.email,
})
```

Derive `session` and `organization` from your trusted backend state. The UUID must match the API key's organization. Return `{ token }` with `Cache-Control: no-store` from a protected endpoint such as `/api/astralbeam/organization-token`. Keep session and CSRF checks, and restrict access to the intended employees.

In the browser:

```ts
import { listTenants } from "@astralbeam/sdk/api"

const response = await fetch("/api/astralbeam/organization-token", { method: "POST" })
const { token } = await response.json()
const tenants = await listTenants({}, { astralBeamToken: token })
```

Tokens last five minutes by default, with `expiresInSeconds` from 60 to 600. Keep them in memory. Role changes apply on the next request. Minting alone does not verify membership. These tokens cannot authenticate chat or manage dashboard configuration. See [API authentication](/docs/api#description/organization-management-jwts) for the full contract.
