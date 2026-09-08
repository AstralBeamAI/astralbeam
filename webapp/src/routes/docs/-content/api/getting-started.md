# Getting started

Provision your application's customers (Tenants) and their users (TenantUsers) over HTTPS from any language. Organization members are your employees using the dashboard, not TenantUsers.

Use the HTTP examples below or download the [OpenAPI document](/api/openapi.json). For embedded chat, see the separate [SDK guides](/docs/sdk).

## Prerequisites

In the dashboard, select your organization and open **API keys** as an owner or developer. Create a key and copy the full `key_…_abo_…` value into your server's `ASTRALBEAM_API_KEY` secret. Never send it to the browser.

The reference uses the fictional key `key_northstar_docs_abo_kQmVrTsXpLnBwYcDfGhJzAeRuIoPsNdFkLwCxVbMnQeRtYuHiOpAsDfGhJkLzXcV` to show the full format. It cannot authenticate. Records are illustrative, and example cursors are abbreviated; use your own key and IDs and reuse cursors returned by the API.

The hosted API base is `https://app.astralbeam.ai/api`. Self-hosted installations use their own origin with the `/api` base, for example `https://beam.example.com/api`.

Run the example once with your own stable identities; creating them again returns `409`. Each request is independent, not one transaction.

## Create a Tenant and its users

With `ASTRALBEAM_API_KEY` already set securely, create a Tenant:

```sh
export ASTRALBEAM_API_URL="https://app.astralbeam.ai/api"
curl --include "$ASTRALBEAM_API_URL/v1/tenants" \
  -H "X-API-Key: $ASTRALBEAM_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"external_id":"customer-42","name":"Acme Logistics","metadata":{"plan":"pro","region":"eu-west-1"}}'
```

The response is `201 Created` with a JSON record and a `Location` header pointing to it. Use the returned internal `id` as `tenant_id` when creating or listing [TenantUsers](/docs/api#tag/tenant_users). The generated reference below includes request and response examples for every operation.

Copy that returned `id` into `TENANT_ID`, then create a user belonging to the Tenant:

```sh
TENANT_ID="<id from the Tenant response>"
curl --include "$ASTRALBEAM_API_URL/v1/tenants/$TENANT_ID/tenant_users" \
  -H "X-API-Key: $ASTRALBEAM_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"external_id":"user-7","name":"Alex Morgan"}'
```

This returns `201 Created` with the new user's internal `id`, the parent `tenant_id`, `admin: false`, and `metadata: {}`. Keep `user-7` as the user's identity in your application and chat tokens.

List that Tenant's users:

```sh
curl --get "$ASTRALBEAM_API_URL/v1/tenants/$TENANT_ID/tenant_users" \
  -H "X-API-Key: $ASTRALBEAM_API_KEY" \
  --data-urlencode "page_size=20"
```

The response is `200 OK` with an `items` array. When `has_next_page` is true, repeat the request with `page_after` set to the returned `end_cursor`. Stop when `has_next_page` is false, even if a cursor is present. See [Pagination](/docs/api#description/pagination) for a complete continuation example.

## Identities and write behavior

On creation, omitted `name` defaults to `null`, `metadata` to `{}`, and TenantUser `admin` to `false`. On PATCH, omitted fields stay unchanged. Metadata updates replace the whole object, not individual keys; `{}` clears it and `null` is rejected. `name: null` clears a name. Stored `admin` is data, not permission to issue privileged JWTs.

| Your identity        | API field                             | Chat token field                     |
| -------------------- | ------------------------------------- | ------------------------------------ |
| Customer ID          | Tenant `external_id`                  | `tenant.id`                          |
| Tenant-local user ID | TenantUser `external_id`              | `user.id`                            |
| Returned internal ID | Response `id`, used in resource paths | Do not use as your external identity |

Minting a chat token does not provision these records. API calls do not mint tokens. For embedded chat, follow the separate [token endpoint guide](/docs/sdk/authentication).

## Recover from an uncertain create

If a create times out or returns `409`, list with `filter[external_id]` set to the exact external ID before deciding what to do next. Inspect `items[0]`: a found record proves that identity exists, not that every attempted field matches. An empty page does not prove a timed-out request cannot still commit. These APIs do not offer idempotency keys.

The [Tenants](/docs/api#tag/tenants) and [TenantUsers](/docs/api#tag/tenant_users) references include filtering examples. For permissions and complete schemas, see [authentication](/docs/api#description/authentication) and the [OpenAPI contract](/api/openapi.json).
