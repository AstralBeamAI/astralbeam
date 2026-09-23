# Authentication

Tenant JWTs identify your application's tenant users to AstralBeam. Let's connect your authenticated session to chat and tenant directories without exposing your API key.

## The auth token endpoint

Chat uses `/api/astralbeam/token` by default. Directories require an explicit `fetchAstralBeamToken` option, which can point to that same endpoint. Your handler authenticates its own session and answers `{ token }`.

Let's issue a token for the user and tenant from your trusted session:

```ts
import { createAstralBeamToken } from "@astralbeam/sdk/server"

const apiKey = process.env.ASTRALBEAM_API_KEY // key_<organizationId>_<id>_abo_<secret>

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" }
  if (!apiKey) return Response.json({ error: "Not configured" }, { status: 503, headers })
  const session = await getApplicationSession(request)
  if (!session) return Response.json({ error: "Unauthenticated" }, { status: 401, headers })
  try {
    const token = await createAstralBeamToken({
      apiKey,
      user: {
        id: session.user.id,
        name: session.user.name,
        metadata: { email: session.user.email },
      },
      tenant: {
        id: session.tenant.id,
        name: session.tenant.name,
        metadata: { plan: session.tenant.plan },
      },
    })
    return Response.json({ token }, { headers })
  } catch {
    return Response.json({ error: "Token could not be issued" }, { status: 500, headers })
  }
}
```

- Answer `cache-control: no-store`: a cached token would outlive its short expiry and reach the wrong end user.
- Return `401` for a missing session and `503` for missing configuration. The widget displays the failure and offers a retry.
- Catch the minting error rather than forwarding it, because its message can describe the API key's expected shape.
- `getApplicationSession` is your host application's authentication adapter, not an SDK function. Apply your framework's session and CSRF protections.

## Mint tokens without JavaScript

`createAstralBeamToken` produces a standard HS256 JWT, so a backend in any language can sign the same token with its own JWT library. Let's derive the signing key and claims from your API key:

1. Split the API key at its last `_abo_`. The part before it, `key_<organizationId>_<id>`, is the key ID. The rest, starting with `abo_`, is the secret.
2. Hash the whole secret, including `abo_`, with SHA-256 and encode the digest as unpadded base64url. The bytes of that ASCII string are the HMAC key, because AstralBeam stores only this digest.
3. Sign with the protected header `{ "alg": "HS256", "typ": "astralbeam+jwt", "kid": "<key ID>" }` and these claims.

| Claim        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| `iss`        | The organization UUID from the API key                   |
| `aud`        | `"astralbeam"`                                           |
| `iat`, `exp` | Seconds since the epoch, 60 to 600 seconds apart         |
| `ver`        | `4`                                                      |
| `user`       | `{ id, name?, admin?, metadata? }`, with no other fields |
| `tenant`     | `{ id, name?, metadata? }`, with no other fields         |

- The `user` and `tenant` objects together must serialize to at most 8 KB of JSON, and the token to at most 16 KB.
- AstralBeam allows 30 seconds of clock skew, so keep your server's clock synchronized.

In Ruby, the [`jwt`](https://rubygems.org/gems/jwt) gem signs it in one call. This short version shows only the signing. For production, copy [`lib/astral_beam.rb`](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos-rails/lib/astral_beam.rb) from the Rails example instead, because it also applies `createAstralBeamToken`'s lifetime, identity, and size checks, and AstralBeam rejects tokens that fail them.

```ruby
module AstralBeam
  UUID = /\h{8}-\h{4}-\h{4}-\h{4}-\h{12}/
  API_KEY = /\A(?<key_id>key_(?<organization_id>#{UUID})_#{UUID})_(?<secret>abo_[A-Za-z]{64})\z/

  def self.token(api_key:, user:, tenant:, expires_in: 5.minutes)
    key = API_KEY.match(api_key) or raise ArgumentError, "api_key must match key_<organizationId>_<id>_abo_<secret>"
    now = Time.now.to_i
    payload = { ver: 4, user:, tenant:, iss: key[:organization_id], aud: "astralbeam", iat: now, exp: now + expires_in.to_i }
    signing_key = Base64.urlsafe_encode64(Digest::SHA256.digest(key[:secret]), padding: false)
    JWT.encode(payload, signing_key, "HS256", { typ: "astralbeam+jwt", kid: key[:key_id] })
  end
end
```

A Rails controller then applies the same rules as the handler above:

```ruby
class AstralBeamTokensController < ApplicationController
  def create
    no_store
    api_key = ENV["ASTRALBEAM_API_KEY"]
    return render json: { error: "Not configured" }, status: :service_unavailable unless api_key

    token = AstralBeam.token(
      api_key:,
      user: { id: Current.user.id.to_s, name: Current.user.name },
      tenant: { id: Current.user.account_id.to_s, name: Current.user.account.name }
    )
    render json: { token: }
  rescue ArgumentError
    render json: { error: "Token could not be issued" }, status: :internal_server_error
  end
end
```

`Current.user` comes from Rails' authentication generator, whose `Authentication` concern requires a signed-in session before this action runs. Substitute your own session and tenant lookup.

## Directory access

The token above permits chat, not directory access. Only set `user.admin: true` after verifying the user's tenant-admin permissions in your application.

**NOTE**: Signed admin authority permits reading the Tenant and reading and writing its TenantUsers through the API. A read-only widget does not make its token read-only. Stored `admin` fields do not grant this authority.

After fetching a JWT, the SDK calls `POST /api/v1/me` to synchronize the Tenant and current TenantUser from signed claims before loading chat or directory data. Ordinary tenant users can synchronize their own identity too. Other TenantUsers appear after their own synchronization or a management API import. Deleting a TenantUser does not revoke its token, and a later synchronization recreates it. Follow [Tenant directories](./listings.md) for provisioning and embedding.

## Where the token comes from

`fetchAstralBeamToken` is the one option for this. Pass `{ url, ...init }` to point at an endpoint, which the widget calls as `fetch(url, init)` with a standard `RequestInit`, or pass a function that retrieves a server-minted token.

```tsx
// A token endpoint on another origin, behind header auth.
<AstralBeamChat
  agentId="agent_01990a5d-ac96-774b-b942-6b13c85384cb_01990a5d-ac96-774b-b942-6b13c85384ca"
  fetchAstralBeamToken={{
    url: "https://api.acme.com/astralbeam/token",
    headers: { authorization: `Bearer ${accessToken}` },
  }}
/>

// Or retrieve a server-minted token, returning undefined when unavailable.
<AstralBeamChat fetchAstralBeamToken={async () => await mintChatAuthToken()} />
```

- Chat defaults to `{ url: "/api/astralbeam/token" }`. For directories, pass this explicitly. Cookie authentication requires a session cookie the browser will send.
- Request defaults: `POST`, `credentials: "include"`, `cache: "no-store"`, and `accept: application/json`. Supplied values override these. Return `{ token }` in JSON.
- Both forms call `/me` after every acquisition and use the same proactive renewal and failure recovery.
- React reads the function prop from the latest render. Closures over current authentication state need no memoization.
- Returning `undefined` or throwing fails closed. The widget shows the error and offers a retry.
- Remount when switching end users so the previous user's transcript or directory rows are discarded.
- A cross-origin endpoint with a custom header is preflighted, so it must answer `OPTIONS` and return `Access-Control-Allow-Headers: authorization` with an exact `Access-Control-Allow-Origin`.

## Refresh and current-user behavior

Components become ready only after token acquisition and `/me` both succeed. They renew while visible and online before expiry, and refresh on focus or reconnect when the last synchronization is at least 60 seconds old. Updating a token-source callback changes the next acquisition without resetting the current session.

A `401` gets one renewal and retry. Other client errors do not trigger token renewal. Transient network, `5xx`, and `429` synchronization failures get up to three delayed retries, respecting `Retry-After`. Failures hide the cached identity and block new authenticated work. Explicit retry or a later focus/reconnect can recover. An already authorized chat stream continues.

Tenant synchronization preserves omitted names, metadata, and admin. Supplied metadata replaces the stored object, and explicit `user.admin` updates stored admin. Organization synchronization returns the current database membership and role without creating records. Profile freshness depends on updated host claims. An older valid JWT can overwrite newer tenant profile fields, so this is not cross-tab conflict resolution.

**NOTE**: Deploy the server's `POST /api/v1/me` endpoint before updating clients. A missing endpoint fails authentication.

## Rules

The tenant JWT identifies the tenant user to AstralBeam, so treat it like a session credential.

- Authenticate once. Derive `user` and `tenant` from the same trusted server-side session, never browser-supplied identity.
- `user.id` and `tenant.id` must be stable 1–255 character strings. Names are optional, and user IDs are tenant-local.
- Set optional `user.admin` only from trusted application permissions.
- Put custom fields in each identity's `metadata`. Tokens are signed, not encrypted, so include no secrets.
- SDK fields use camelCase. AstralBeam-owned JWT claims use snake_case, preserving caller-owned metadata keys.
- The issuer is the organization UUID from the API key, with audience `astralbeam`. AstralBeam does not require `sub`.
- `expiresInSeconds` accepts 60–600 seconds and defaults to 300. The SDK retains tokens in memory and renews before expiry.

**NOTE**: Internal tools can also use [organization-management tokens](./api.md). They are separate from tenant authentication and cannot authenticate chat or create a dashboard session.

## Troubleshooting

- A disabled composer with an error note means the token fetch failed. The retry link refetches.
- A CORS error in the console is usually a non-200 token response whose error path omits CORS headers.
