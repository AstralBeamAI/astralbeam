# API client

Use `@astralbeam/sdk/api` to manage Tenants and TenantUsers from your server or an authorized browser session. The same helpers work in both environments.

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
  const users = await listUsersForTenant(tenant.id, { page_size: 20 }, options)
}
```

Resource calls require a token with the signed `user.admin` claim and are restricted to that Tenant. JWT callers cannot create or update Tenants. Ordinary tenant users can use chat but cannot manage these resources. Stored user admin values do not change an already-issued token's authority.

## Filtering, updates, and errors

- Filter lists with `{ "filter[external_id]": "acme" }`. Matching is exact and case-sensitive.
- Pass either `page_after` or `page_before`, not both. A null continuation means there is no page in that direction. Listings are live, not snapshots.
- PATCH sends only the fields supplied. `name: null` clears a name. Metadata replaces the whole object, and `{}` clears it.
- Set `apiUrl` to your deployment's `/api` base and use `signal` to cancel a request.
- Requests do not retry automatically and refuse redirects. A failed or aborted mutation may already have committed. Low-level JWT calls do not refresh tokens automatically.

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
