# Authentication

Chat and manage your application's Tenants and TenantUsers under `/api/v1`. See the [quickstart](/docs/api#description/getting-started) and [OpenAPI 3.1 contract](/api/openapi.json).

## Organization API keys

Send the full decorated key through `X-API-Key` or `Authorization: Bearer <key>`. If both are present, `X-API-Key` takes precedence. Keys manage resources throughout their organization and retain their configured rate limits. Dashboard session cookies alone are not accepted. Never expose an organization key to browser code.

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
