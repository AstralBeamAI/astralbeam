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

## Directory access

The token above permits chat, not directory access. Only set `user.admin: true` after verifying the user's tenant-admin permissions in your application.

**NOTE**: Signed admin authority permits reading the Tenant and reading and writing its TenantUsers through the API. A read-only widget does not make its token read-only. Stored `admin` fields do not grant this authority.

Directory records must already exist, with `external_id` values matching the token's `tenant.id` and `user.id`. Authentication does not provision them. Follow [Tenant directories](./listings.md) for provisioning and embedding.

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
- Both forms run on renewal and after token rejection, keeping rotating credentials current.
- React reads the function prop from the latest render. Closures over current authentication state need no memoization.
- Returning `undefined` or throwing fails closed. The widget shows the error and offers a retry.
- Remount when switching end users so the previous user's transcript or directory rows are discarded.
- A cross-origin endpoint with a custom header is preflighted, so it must answer `OPTIONS` and return `Access-Control-Allow-Headers: authorization` with an exact `Access-Control-Allow-Origin`.

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
