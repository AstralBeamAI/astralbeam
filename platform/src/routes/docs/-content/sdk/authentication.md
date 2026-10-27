# Authentication

Connect your application's authenticated users to chat with short-lived tenant JWTs. Your server signs them with an organization API key. The browser receives only the token. Any backend language and session system can provide this endpoint.

## The auth token endpoint

Expose `POST /api/astralbeam/token` on your backend. Authenticate the request, derive user and customer-account IDs from the session, and return `{ token }` with `Cache-Control: no-store`. Keep your framework's session and CSRF protections.

The [Quickstart](/docs/start/quickstart#3-connect-your-backend) has TypeScript and Rails handlers. With the JavaScript SDK, sign the session identity like this:

```ts
import { createAstralBeamToken } from "@astralbeam/sdk/server"

const token = await createAstralBeamToken({
  apiKey: process.env.ASTRALBEAM_API_KEY!,
  user: { id: session.user.id },
  tenant: { id: session.tenant.id },
})
```

Never accept these IDs from the request body. Return an authentication error for a missing session and keep signing errors private.

## Where the token comes from

Chat calls `/api/astralbeam/token` by default. Set `fetchAstralBeamToken` for another endpoint or custom authentication:

<!-- ::start:tabs variant="files" -->

```tsx title="Endpoint"
<AstralBeamChat
  fetchAstralBeamToken={{
    url: "https://api.acme.com/api/astralbeam/token",
    headers: { Authorization: `Bearer ${accessToken}` },
  }}
/>
```

```tsx title="Function"
async function fetchToken() {
  const response = await fetch("/api/astralbeam/token", { method: "POST" })
  return response.json()
}

;<AstralBeamChat fetchAstralBeamToken={fetchToken} />
```

<!-- ::end:tabs -->

Endpoint requests default to `POST`, `credentials: "include"`, `cache: "no-store"`, and JSON responses. Standard `RequestInit` options override them. Keep CSRF headers when your backend requires them.

Directories require an explicit token source. Both forms synchronize `/me` and renew tokens automatically. Returning `undefined` or throwing blocks authenticated work and offers retry.

Cross-origin endpoints must allow your application's origin, required headers, and `OPTIONS` preflight. Cookie-based requests also need credentialed CORS.

## Switching workspaces

Remount chat when the signed-in user or Tenant changes. Updating a token callback alone takes effect only on the next acquisition:

```tsx
<AstralBeamChat key={`${session.tenant.id}:${session.user.id}`} />
```

Update your trusted server session before rendering the new identity. The token endpoint must check membership in the selected Tenant, and every host tool must enforce the same scope. Clearing the transcript alone does not establish a new identity.

[Linearity](https://github.com/AstralBeamAI/astralbeam/tree/main/examples/linearity-react) demonstrates remounting across two mock workspaces. Its demo identity policy is not suitable for production.

## Directory access

Verify customer-admin permissions on your backend before signing `user.admin: true`. This grants reading the Tenant and reading and writing its TenantUsers. A read-only widget does not reduce token authority, and the stored `admin` field grants none.

The SDK synchronizes the signed Tenant and current TenantUser through `/me`. Other users appear after their own synchronization or a management API import. Deleting a TenantUser does not revoke its token: a later synchronization recreates it. See [Directories](./listings.md).

## Usage limits

Default usage limits apply automatically. Add plan-specific IDs with `usageLimits`. These apply alongside the defaults. See [Usage limits](/docs/dashboard/usage-limits).

```ts
const token = await createAstralBeamToken({ apiKey, user, tenant, usageLimits: planLimits[plan] })
```

## Troubleshooting

- For a disabled composer, check the token endpoint and retry. `apiUrl` must point to the deployment that issued your API key.
- For a revoked or expired key, create a replacement under **API Keys** and deploy it to your backend. New tokens signed with the old key cannot restore access.
- Use widget `debug` logging or headless `streamCallbacks.onError` to distinguish host endpoint failures from rejected AstralBeam tokens.
- For CORS errors, check headers on failure responses as well as successful ones.

## Refresh and current-user behavior

Authentication becomes ready after token acquisition and `/me` succeed. Visible, online components renew before expiry and resynchronize on focus or reconnect when the last check is at least 60 seconds old. Callback changes apply to the next acquisition.

A `401` gets one renewal and retry. Network, `5xx`, and `429` synchronization failures get up to three delayed retries, respecting `Retry-After`. Other client errors require explicit retry. Failed synchronization hides the cached identity and blocks new work, while an authorized stream continues.

Synchronization preserves omitted profile fields. Supplied metadata replaces the whole object. An older JWT can overwrite newer profile fields, so use current host claims. See the [current-user API](/docs/api#description/current-user) for response shapes and update rules.

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

## Mint tokens without JavaScript

Use an HS256 JWT library in your backend language. The [Quickstart's Rails example](/docs/start/quickstart#3-connect-your-backend) shows a token endpoint. To implement the signing yourself:

1. Split the API key at its last `_abo_`. The part before it, `key_<organizationId>_<id>`, is the key ID. The rest, starting with `abo_`, is the secret.
2. Hash the whole secret, including `abo_`, with SHA-256 and encode the digest as unpadded base64url. The bytes of that ASCII string are the HMAC key, because AstralBeam stores only this digest.
3. Sign with the protected header `{ "alg": "HS256", "typ": "astralbeam+jwt", "kid": "<key ID>" }` and these claims.

| Claim          | Value                                                             |
| -------------- | ----------------------------------------------------------------- |
| `iss`          | The organization UUID from the API key                            |
| `aud`          | `"astralbeam"`                                                    |
| `iat`, `exp`   | Seconds since the epoch, 60 to 600 seconds apart                  |
| `ver`          | `4`                                                               |
| `user`         | `{ id, name?, admin?, metadata? }`, with no other fields          |
| `tenant`       | `{ id, name?, metadata? }`, with no other fields                  |
| `usage_limits` | Optional. Up to 20 usage limit IDs, `limit_<organizationId>_<id>` |

- The `user` and `tenant` objects together must serialize to at most 8 KB of JSON, and the token to at most 16 KB.
- AstralBeam allows 30 seconds of clock skew, so keep your server's clock synchronized.

See the [Rails token endpoint](/docs/start/quickstart#3-connect-your-backend) for a complete signing example.
