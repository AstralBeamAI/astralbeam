# Authentication

Your server authenticates the application session and issues a short-lived chat JWT. The widget receives that token, never your API key or application session credential.

## The auth token endpoint

`/api/astralbeam/token` by default. Point the widget elsewhere with `fetchAstralBeamToken`. Your handler authenticates its own session, mints a chat token with `createAstralBeamToken`, and answers `{ token }`.

```ts
import { createAstralBeamToken } from "@astralbeam/sdk/server"

const apiKey = process.env.ASTRALBEAM_API_KEY // key_<organizationId>_<id>_abo_<secret>

export async function POST(request: Request) {
  if (!apiKey) return Response.json({ error: "Not configured" }, { status: 503 })
  const session = await getApplicationSession(request)
  if (!session) return Response.json({ error: "Unauthenticated" }, { status: 401 })
  const token = await createAstralBeamToken({
    apiKey,
    user: {
      id: session.user.id, // required; stable and unique within this tenant
      name: session.user.name,
      metadata: { email: session.user.email },
    },
    tenant: {
      id: session.tenant.id,
      name: session.tenant.name,
      metadata: { plan: session.tenant.plan },
    },
  })
  return Response.json({ token }, { headers: { "cache-control": "no-store" } })
}
```

- Answer `cache-control: no-store`: a cached token would outlive its short expiry and reach the wrong end user.
- Return `401` for a missing session and `503` for missing configuration. The widget displays the failure and offers a retry.
- Catch the minting error rather than forwarding it, because its message can describe the API key's expected shape.
- Only your handler shape changes per framework. The minting call is identical everywhere the fetch standard reaches.

## Where the chat auth token comes from

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

- Default `{ url: "/api/astralbeam/token" }`, posted with the page's cookies, which needs a session cookie the browser will send.
- Request defaults: `POST`, `credentials: "include"`, `cache: "no-store"`, and `accept: application/json`. Supplied values override these. Return `{ token }` in JSON.
- Both forms run on renewal and after token rejection, keeping rotating credentials current.
- React reads the function prop from the latest render. Closures over current authentication state need no memoization.
- Returning `undefined` or throwing fails closed. The composer shows the error and its retry link asks you again.
- Remount when switching end users so the previous user's transcript is discarded.
- A cross-origin endpoint with a custom header is preflighted, so it must answer `OPTIONS` and return `Access-Control-Allow-Headers: authorization` with an exact `Access-Control-Allow-Origin`.

## Rules

The chat auth token identifies the tenant user to AstralBeam, so treat it like a session credential.

- Authenticate once. Derive `user` and `tenant` from the same trusted server-side session, never browser-supplied identity.
- `user.id` and `tenant.id` must be stable 1–255 character strings. Names are optional, and user IDs are tenant-local.
- Set optional `user.admin` only from trusted application permissions.
- Put custom fields in each identity's `metadata`. Tokens are signed, not encrypted, so include no secrets.
- SDK fields use camelCase. AstralBeam-owned JWT claims use snake_case, preserving caller-owned metadata keys.
- The issuer is the organization UUID from the API key, with audience `astralbeam`. AstralBeam does not require `sub`.
- `expiresInSeconds` accepts 60–600 seconds and defaults to 300. The SDK retains tokens in memory and renews before expiry.

## Organization management tokens

Use `createAstralBeamOrganizationToken` for organization-wide Tenant and TenantUser management. This is separate from chat authentication and does not create a dashboard login session.

```ts
import { createAstralBeamOrganizationToken } from "@astralbeam/sdk/server"

const token = await createAstralBeamOrganizationToken({
  apiKey,
  email: session.user.email,
  organizationId: configuredOrganizationId,
  expiresInSeconds: 300,
})
```

- Authenticate and authorize the operator on your server. Never take email or organization ownership directly from browser input.
- The email must match an existing organization user and membership. The API rechecks database roles on every request: owners/developers read and write, viewers read only.
- `organizationId` must match the API key's Organization. Tokens last 60–600 seconds, defaulting to 300.
- Pass the token as `astralBeamToken` to `/api` helpers. Never encode roles in it. Missing membership or insufficient permission returns `403`.
- Return tokens with `Cache-Control: no-store`. Keep API keys server-side and handle minting errors without exposing their details.

See the [API client guide](./api) for a complete host endpoint, browser calls, filtering, and token-expiry recovery. Organization tokens cannot authenticate chat or dashboard administration.

## Troubleshooting

- A disabled composer with an error note means the token fetch failed. The retry link refetches.
- A CORS error in the console is usually a non-200 token response whose error path omits CORS headers.
