# Getting started

Create customer accounts and users from your backend. AstralBeam calls them Tenants and TenantUsers, separate from the colleagues who use your dashboard.

Use the HTTP examples below or download the [OpenAPI document](/api/openapi.json). For embedded chat, see the separate [SDK guides](/docs/sdk).

## Prerequisites

In the dashboard, select your organization and open **API keys** as an owner or developer. Create a key and copy the full `key_…_abo_…` value into your server's `ASTRALBEAM_API_KEY` secret. Never send it to the browser.

The hosted API base is `https://astralbeam.ai/api`. Self-hosted installations use their own origin with the `/api` base, for example `https://beam.example.com/api`.

Use your application's stable customer and user IDs. Creating the same identity again returns `409`. Each request commits independently.

## Create a Tenant and its users

With `ASTRALBEAM_API_KEY` already set securely, create a Tenant:

```sh
export ASTRALBEAM_API_URL="https://astralbeam.ai/api"
curl --include "$ASTRALBEAM_API_URL/v1/tenants" \
  -H "X-API-Key: $ASTRALBEAM_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"external_id":"customer-42","name":"Acme Logistics"}'
```

Expect `201 Created` and a JSON record. Copy its internal `id` into `TENANT_ID`, then create a user:

```sh
TENANT_ID="<id from the Tenant response>"
curl --include "$ASTRALBEAM_API_URL/v1/tenants/$TENANT_ID/tenant_users" \
  -H "X-API-Key: $ASTRALBEAM_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"external_id":"user-7","name":"Alex Morgan"}'
```

Expect `201 Created` with the new user's internal `id`. Keep `user-7` as their external identity in your application and chat tokens.

List that Tenant's users:

```sh
curl --get "$ASTRALBEAM_API_URL/v1/tenants/$TENANT_ID/tenant_users" \
  -H "X-API-Key: $ASTRALBEAM_API_KEY" \
  --data-urlencode "page_size=20"
```

Expect `200 OK` with Alex in the `items` array. Follow the returned cursor to load more users. See [Pagination](/docs/api#description/pagination).

## Identities and write behavior

Create requests default to a null name, empty metadata, and false stored admin. PATCH changes only supplied fields. Metadata replaces the whole object, so include every key you want to keep. Use `{}` to clear metadata and `name: null` to clear a name. Stored admin does not grant JWT privileges.

| Your identity | API field | Chat token field |
| --- | --- | --- |
| Customer ID | Tenant `external_id` | `tenant.id` |
| Tenant-local user ID | TenantUser `external_id` | `user.id` |
| Returned internal ID | Response `id`, used in resource paths | Do not use as your external identity |

For embedded chat, follow the [token endpoint guide](/docs/sdk/authentication). The SDK synchronizes the signed customer and user when they connect, so you do not need to create them first through this API.

## Recover from an uncertain create

If a create times out or returns `409`, look up the exact external ID before retrying:

```sh
curl --get "$ASTRALBEAM_API_URL/v1/tenants" \
  -H "X-API-Key: $ASTRALBEAM_API_KEY" \
  --data-urlencode "filter[external_id]=customer-42"
```

Check a found record's fields against the intended values. A timed-out request may still commit after an empty lookup. These APIs do not offer idempotency keys.

The [Tenants](/docs/api#tag/tenants) and [TenantUsers](/docs/api#tag/tenant_users) references include filtering examples. For permissions and complete schemas, see [authentication](/docs/api#description/authentication) and the [OpenAPI contract](/api/openapi.json).
