# Authentication

Chat and manage your application's Tenants and TenantUsers under `/api/v1`. See the [quickstart](/docs/api#description/getting-started) and [OpenAPI 3.1 contract](/api/openapi.json).

## Organization API keys

Send the full decorated key through `X-API-Key` or `Authorization: Bearer <key>`. If both are present, `X-API-Key` takes precedence. Keys manage resources throughout their organization and retain their configured rate limits. Dashboard session cookies alone are not accepted. Never expose an organization key to browser code.

## Organization management JWTs

The trusted API-key holder selects the authenticated member and delegates their current database permissions to the token recipient. These checks constrain the delegated token, not its issuer, who retains owner-equivalent resource access throughout the Organization.

A short-lived organization-management JWT identifies an organization member for Tenant and TenantUser operations throughout its issuing Organization. The server reads current roles from the database on every request: owners and developers can GET, POST, and PATCH; viewers can GET only. Unknown roles grant no access. Composable roles retain the grants of their recognized roles. Issue tokens only to authenticated operators authorized by the host application to access that Organization.

The protected type is `astralbeam-organization+jwt`, distinct from chat JWTs. Claims are version `ver: 1`, authenticated operator `email`, Organization UUID `organization_id`, matching issuer `iss`, audience `astralbeam`, `iat`, and `exp`. There is no `sub` or user-ID claim. The lifetime is 60–600 seconds. Both Organization claims must match the signing key's Organization, and the key must remain enabled and unexpired.

Organization JWTs cannot authenticate chat or manage dashboard Members, API keys, or configuration. Resource requests are limited to 100 per five minutes per Organization and resolved organization user. Changing tokens or the user's email does not reset the rate bucket.

The email must identify an existing organization user with membership in the claimed Organization. The server matches email case-insensitively and checks membership on every request, returning `403` when it is absent, removed, or lacks permission for the operation. Role changes apply on the next request. Do not include role, roles, or admin claims in organization JWTs; they are rejected. Authentication does not create users, memberships, or login sessions.

## Current user

Send a tenant or organization JWT to `POST /api/v1/me` without a request body. Identity comes only from the verified JWT, and query parameters are rejected. API keys and dashboard cookies cannot authenticate this endpoint.

Tenant JWTs return `{ scope: "tenant", organization: { id }, tenant, user }`, using the public Tenant and TenantUser records. The request upserts only the signed Tenant and current TenantUser in one transaction. Ordinary non-admin users can synchronize themselves. Omitted names, metadata, and admin preserve existing values. Supplied metadata replaces the stored object, and explicit `user.admin` updates stored admin. New records default to null names, empty metadata, and false admin.

Organization JWTs return `{ scope: "organization", organization: { id }, user: { id, name, email, role } }`. Membership and role are read again, including for viewers, without creating users, memberships, tenants, or sessions. Removed membership returns `403`.

Success is `200` with `Cache-Control: no-store`. Invalid or revoked JWTs return `401`. Synchronization has its own 100-request-per-five-minute bucket per authenticated identity. Throttling returns `429` with `Retry-After`.

## Tenant administrator JWTs

A valid chat JWT with signed `user.admin: true` can read its own Tenant and read/create/update TenantUsers within it. Tenant writes are forbidden. Non-admin JWTs cannot access these resource operations.

The JWT carries separate `user` and `tenant` claims. Signed `tenant.id` is an external identity, resolved within the issuing organization. Authentication never upserts identities or requires a persisted calling TenantUser.

Call `GET /api/v1/tenants` with the JWT to obtain your Tenant's internal `id` for TenantUser routes. It returns an empty list if the Tenant does not exist. TenantUser lists and other reads/writes return `404` for a missing or inaccessible Tenant or record.

**Stored TenantUser admin does not grant or revoke JWT privileges.** Authority comes from the signed claim until expiry or backing-key invalidation.

JWT resource requests have a separate limit of 100 requests per five minutes per organization, external Tenant, and external user identity. Throttling returns `429` and `Retry-After` seconds.

## Chat and downloads

Chat runs and configuration accept a Bearer JWT without requiring administrator privileges or persisted Tenant/TenantUser records. Organization API keys cannot call chat directly. Chat runs have a separate limit of 20 requests per minute per organization, external Tenant, and external user identity.

Artifact downloads use the signed `ticket` query parameter provided by the agent. Treat download URLs as temporary credentials. They do not require a Bearer header.

## Browser transport

The API permits credential-free CORS for GET, POST, PATCH, and OPTIONS. Browser callers must use scoped JWTs, not organization keys. Preflight needs no authentication. All resource responses use `Cache-Control: no-store`.

## Examples

Set `ASTRALBEAM_API_KEY` securely in your server environment, then send it with each request:

```sh
curl "https://app.astralbeam.ai/api/v1/tenants" \
  -H "X-API-Key: $ASTRALBEAM_API_KEY"
```

Alternatively, with an admin JWT in `ASTRALBEAM_TOKEN`, use Bearer authentication.

```sh
curl "https://app.astralbeam.ai/api/v1/tenants" \
  -H "Authorization: Bearer $ASTRALBEAM_TOKEN"
```

Both return `200 OK` with a paginated list in the credential's scope. POST/PATCH requests also require `Content-Type: application/json`.
