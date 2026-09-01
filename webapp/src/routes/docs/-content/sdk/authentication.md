# Authentication

The widget will not chat until it has a token, and it never sees your API key. Your app adds one endpoint that authenticates its own session, then mints a short-lived token from trusted server-side state.

## The token endpoint

`/api/astralbeam/token` by default; change it with the `authEndpoint` option.

```ts
import { createAstralBeamChatToken } from "@astralbeam/sdk/server"

export async function POST(request: Request) {
  const session = await requireApplicationSession(request)
  const token = await createAstralBeamChatToken({
    apiKey: process.env.ASTRALBEAM_API_KEY!, // key_<organization>_<key>_abo_<secret>
    tenantUser: {
      id: session.user.id, // required; stable and unique per organization
      name: session.user.name,
      email: session.user.email,
      tenant: { id: session.tenant.id, name: session.tenant.name },
    },
  })
  return Response.json({ token }, { headers: { "cache-control": "no-store" } })
}
```

## Rules

The token identifies the tenant user to AstralBeam, so treat it like a session credential.

- Authenticate your own session before minting; anyone who can call this endpoint can drive the chat.
- Derive `tenantUser` from server-side state only, never from anything the browser sent.
- Tokens are signed, not encrypted: never put a secret in `tenantUser`.
- `tenantUser.id` must be a stable 1–255 character string; extra fields must be plain JSON.
- Lifetimes are 60–600 seconds (`expiresInSeconds`), five minutes by default.
- The SDK keeps the token in memory only and renews it before it expires.

## Troubleshooting

- A disabled composer with an error note means the token fetch failed; the retry link refetches.
- A CORS error in the console is usually a non-200 token response whose error path omits CORS headers.
