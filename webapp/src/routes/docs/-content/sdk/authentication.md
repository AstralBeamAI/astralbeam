# Authentication

The widget will not chat until it has a chat auth token, and it never sees your API key. Your app adds one endpoint that authenticates its own session, then mints a short-lived chat auth token from trusted server-side state.

Throughout these guides, "chat auth token" always means this credential — the short-lived JWT your server signs for AstralBeam. It is never your application's own session cookie or access token, which stays yours and never reaches AstralBeam.

## The auth token endpoint

`/api/astralbeam/token` by default; point the widget elsewhere with `fetchChatAuthToken`. `createChatAuthToken` is the only server helper: your handler authenticates its own session, mints the chat auth token, and answers `{ token }`.

```ts
import { createChatAuthToken } from "@astralbeam/sdk/server"

const apiKey = process.env.ASTRALBEAM_API_KEY // key_<organization>_<key>_abo_<secret>

export async function POST(request: Request) {
  if (!apiKey) return Response.json({ error: "Not configured" }, { status: 503 })
  const session = await getApplicationSession(request)
  if (!session) return Response.json({ error: "Unauthenticated" }, { status: 401 })
  const token = await createChatAuthToken({
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
- Fail closed on a missing API key or session, with your framework's own 401 and 503; the widget shows the error and offers a retry.
- Catch the minting error rather than forwarding it, because its message can describe the API key's expected shape.
- Only your handler shape changes per framework; the minting call is identical everywhere the fetch standard reaches.

## Where the chat auth token comes from

`fetchChatAuthToken` is the one option for this. Pass `{ url, ...init }` to point at an endpoint, which the widget calls as `fetch(url, init)` with a standard `RequestInit`, or pass a function to mint the token in the page yourself.

```tsx
// A token endpoint on another origin, behind header auth.
<AstralBeamChat
  agentId="agt_acme_support"
  fetchChatAuthToken={{
    url: "https://api.acme.com/astralbeam/token",
    headers: { authorization: `Bearer ${accessToken}` },
  }}
/>

// Or mint it yourself: return { token }, or undefined when you cannot.
<AstralBeamChat fetchChatAuthToken={async () => await mintChatAuthToken()} />
```

- Default `{ url: "/api/astralbeam/token" }`, posted with the page's cookies, which needs a session cookie the browser will send.
- The request form defaults to `POST`, `credentials: "include"`, `cache: "no-store"`, and `accept: application/json`; anything you set in the object wins, and the widget still expects `{ token }` in the JSON response.
- Either form runs again for every token — near expiry and after a token is rejected — so a rotating credential stays current instead of being captured once.
- The React prop's function form is read from the latest render, so an inline closure over current auth state is fine and needs no memoization.
- Returning `undefined` or throwing fails closed; the composer shows the error and its retry link asks you again.
- Read per token, so changing it applies to the next one; switching to another end user means a fresh mount, since the transcript belongs to the previous one.
- A cross-origin endpoint with a custom header is preflighted, so it must answer `OPTIONS` and return `Access-Control-Allow-Headers: authorization` with an exact `Access-Control-Allow-Origin`.

## Rules

The chat auth token identifies the tenant user to AstralBeam, so treat it like a session credential.

- Authenticate your own session before minting; anyone who can call this endpoint can drive the chat.
- Authenticate once, then derive `user` and `tenant` separately from that same application session.
- Derive `user` and `tenant` from server-side state only, never from anything the browser sent.
- Tokens are signed, not encrypted: never put a secret in `user` or `tenant`.
- `user.id` and `tenant.id` must be stable 1–255 character strings; tenant and user names are optional.
- `user.admin` is optional; omit it unless trusted application state explicitly grants or revokes admin access.
- Put custom tenant and tenant-user fields in their respective `metadata` JSON objects; never include secrets.
- SDK fields use camelCase; AstralBeam-owned JWT claims use snake_case, while `metadata` keys are preserved verbatim.
- The JWT issuer is the organization slug from the API key and its audience is `astralbeam`. AstralBeam does not require or interpret `sub`.
- Lifetimes are 60–600 seconds (`expiresInSeconds`), five minutes by default.
- The SDK keeps the chat auth token in memory only and renews it before it expires.

## Troubleshooting

- A disabled composer with an error note means the token fetch failed; the retry link refetches.
- A CORS error in the console is usually a non-200 token response whose error path omits CORS headers.
