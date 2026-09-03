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
