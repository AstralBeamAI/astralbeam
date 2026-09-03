# Authentication

The widget will not chat until it has a token, and it never sees your API key. Your app adds one endpoint that authenticates its own session, then mints a short-lived token from trusted server-side state.

## The token endpoint

`/api/astralbeam/token` by default; change it with the `authTokenUrl` option. `createAstralBeamTokenRoute` builds the whole fetch-standard handler: the method check, the unconfigured-key 503, the unauthenticated 401, and the `no-store` header.

```ts
import { createAstralBeamTokenRoute } from "@astralbeam/sdk/server"

export const POST = createAstralBeamTokenRoute({
  apiKey: () => process.env.ASTRALBEAM_API_KEY, // key_<organization>_<key>_abo_<secret>
  authenticate: (request) => getApplicationSession(request), // return nothing for a 401
  user: (session) => ({
    id: session.user.id, // required; stable and unique within this tenant
    name: session.user.name,
    metadata: { email: session.user.email },
  }),
  tenant: (session) => ({
    id: session.tenant.id,
    name: session.tenant.name,
    metadata: { plan: session.tenant.plan },
  }),
})
```

For full control, mint the token with `createAstralBeamChatToken({ apiKey, user, tenant })` and answer with `Response.json({ token })` plus `cache-control: no-store`.

## A backend on another origin

By default the widget POSTs `authTokenUrl` with the page's cookies, which needs a session cookie the browser will send. When your API lives on another origin behind bearer or custom-header auth, pass `getAuthToken` and fetch the token yourself.

```tsx
<AstralBeamChat
  agentId="agt_acme_support"
  getAuthToken={async () => {
    const response = await fetch("https://api.acme.com/astralbeam/token", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) throw new Error(`The token endpoint answered ${response.status}`)
    return (await response.json()).token
  }}
/>
```

- `getAuthToken` replaces the widget's own request entirely: you choose the method, headers, body, and response shape, and it never reads `authTokenUrl`.
- It is called whenever the widget needs a token, near expiry and after one is rejected, so mint a fresh token instead of returning a memoized one.
- Throw to fail closed; the composer shows the error and its retry link calls `getAuthToken` again.
- The React prop always reads the latest render's callback, so an inline arrow over current auth state is fine and needs no memoization.
- Like `authTokenUrl`, it is fixed at mount: `handle.update` rejects it.
- Cookies do work cross-origin without it if your endpoint returns `Access-Control-Allow-Credentials: true` with an exact origin, its cookie is `SameSite=None; Secure`, and it answers the preflight; browser cookie policies make this the more fragile route.

## Rules

The token identifies the tenant user to AstralBeam, so treat it like a session credential.

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
- The SDK keeps the token in memory only and renews it before it expires.

## Troubleshooting

- A disabled composer with an error note means the token fetch failed; the retry link refetches.
- A CORS error in the console is usually a non-200 token response whose error path omits CORS headers.
