# Authentication

For backend integrations, use an organization API key. For browser integrations, mint a short-lived JWT on your server. Choose the credential for the task:

| Task                                              | Credential                                |
| ------------------------------------------------- | ----------------------------------------- |
| Manage customers and users from your backend      | Organization API key                      |
| Chat for a customer user                          | Tenant JWT                                |
| Let a customer administrator manage their users   | Tenant JWT with signed `user.admin: true` |
| Build an internal directory for dashboard members | Organization-management JWT               |

Start with the [API quickstart](/docs/api#description/getting-started). Keep organization keys out of browser code.

## Organization API keys

Send the full `key_…_abo_…` value through `X-API-Key` or `Authorization: Bearer <key>`. `X-API-Key` takes precedence when both are present. A key grants access throughout its organization. Dashboard session cookies cannot authenticate API requests.

## Examples

Set `ASTRALBEAM_API_KEY` securely in your server environment, then send it with each request:

```sh
curl "https://astralbeam.ai/api/v1/tenants" \
  -H "X-API-Key: $ASTRALBEAM_API_KEY"
```

Alternatively, with an admin JWT in `ASTRALBEAM_TOKEN`, use Bearer authentication.

```sh
curl "https://astralbeam.ai/api/v1/tenants" \
  -H "Authorization: Bearer $ASTRALBEAM_TOKEN"
```

Both return `200 OK` with a paginated list in the credential's scope. POST/PATCH requests also require `Content-Type: application/json`.

## Tenant administrator JWTs

A valid chat JWT with signed `user.admin: true` can read its own Tenant and read/create/update TenantUsers within it. Tenant writes are forbidden. Non-admin JWTs cannot access these resource operations.

The JWT carries separate `user` and `tenant` claims. Signed `tenant.id` is an external identity, resolved within the issuing organization. Authentication never upserts identities or requires a persisted calling TenantUser.

Call `GET /api/v1/tenants` with the JWT to obtain your Tenant's internal `id` for TenantUser routes. It returns an empty list if the Tenant does not exist. TenantUser lists and other reads/writes return `404` for a missing or inaccessible Tenant or record.

**Stored TenantUser admin does not grant or revoke JWT privileges.** Authority comes from the signed claim until expiry or backing-key invalidation.

JWT resource requests have a separate limit of 100 requests per five minutes per organization, external Tenant, and external user identity. Throttling returns `429` and `Retry-After` seconds.

## Chat and downloads

Chat requires a tenant JWT and conversation participation. Before sending, call `POST /api/v1/me` and select an authorized saved conversation. The SDK handles both. Request rates are separate for new turns, tool results, and uploads. See [chat limits](/docs/sdk/limits#requests).

Downloads use the saved `fileId` and `threadId` and check current conversation access. Administrative downloads also pass `tenantId` and require an organization key, a member JWT with directory-read permission, or a Tenant admin JWT within its Tenant. Published files remain available after sandbox shutdown.

## Current user

Send a tenant or organization JWT to `POST /api/v1/me` without a request body. Identity comes only from the verified JWT, and query parameters are rejected. API keys and dashboard cookies cannot authenticate this endpoint.

Tenant JWTs return `{ scope: "tenant", organization: { id }, tenant, user }`. The request creates or updates the signed Tenant and current TenantUser together, including for ordinary non-admin users. Omitted profile fields stay unchanged. Supplied metadata replaces the stored object, and explicit `user.admin` updates stored admin. New records default to null names, empty metadata, and false admin.

Organization JWTs return `{ scope: "organization", organization: { id }, user: { id, name, email, role } }` from the member's current role. They create no records or sessions. Removed membership returns `403`.

Success is `200` with `Cache-Control: no-store`. Invalid or revoked JWTs return `401`. Synchronization has its own 100-request-per-five-minute bucket per authenticated identity. Throttling returns `429` with `Retry-After`.

## Organization management JWTs

Use these tokens for an existing organization member's Tenant and TenantUser operations. Each request checks current membership and roles: owners and developers can read and write, viewers can only read. Recognized roles combine their grants. Missing membership or permission returns `403`. Role changes apply immediately.

The issuer must authenticate the operator and authorize access to the selected organization. The issuing API key retains organization-wide authority. Use the [SDK helper](/docs/sdk/api#browser-organization-jwt), or sign these fields with HS256:

| Field | Value |
| --- | --- |
| Protected `typ` | `astralbeam-organization+jwt` |
| `ver` | `1` |
| `email` | Verified operator email, matched case-insensitively to an existing member |
| `organization_id`, `iss` | Organization UUID matching the signing API key |
| `aud` | `astralbeam` |
| `iat`, `exp` | Epoch seconds, 60–600 seconds apart |

Use the API key's ID as protected `kid` and its hashed secret as the signing key, as described in the [token format](/docs/sdk/authentication#mint-tokens-without-javascript). The key must remain enabled and unexpired. Do not include `role`, `roles`, `admin`, `sub`, or user-ID claims.

These tokens grant API access within the member's current permissions, without creating a dashboard session or membership. They cannot authenticate chat or change dashboard settings. Requests are limited to 100 per five minutes per organization and resolved member.

## Browser transport

The API permits credential-free CORS for GET, POST, PUT, PATCH, DELETE, and OPTIONS. Browser callers must use scoped JWTs, not organization keys. Preflight needs no authentication. Responses use `Cache-Control: no-store` except successful chat images and previews, which may use a private browser cache for 60 seconds and vary by authorization and preview headers.
