# @astralbeam/sdk

Embed an agent chat sidebar in your web app, or build your own UI with the headless core. The widget isolates its styles in a shadow root.

```sh
npm install @astralbeam/sdk
```

## Quick start

One component in React, one function everywhere else. Full setup, including the required token endpoint, is in [Getting started](https://app.astralbeam.ai/docs/sdk/getting-started).

```tsx
import { AstralBeamChat } from "@astralbeam/sdk/react"

export function Sidebar() {
  return <AstralBeamChat />
}
```

```ts
import { mountAstralBeamChat } from "@astralbeam/sdk/client"

const handle = mountAstralBeamChat(document.getElementById("sidebar"), {})
// Update with handle.update({ colorScheme: "dark" }), then clean up with handle.unmount().
```

- The widget fills its container, so give it a parent with a definite height (`min-h-0` in a flex column).
- Chat uses the hosted cloud by default. Tokens come from your application. For self-hosting, set `apiUrl` to your deployment’s `/api` base.
- `@astralbeam/sdk/client` ships no React. The chat loads as a lazy chunk with its own bundled copy.
- No runtime dependencies. `react` and `react-dom` are optional peers used only by `@astralbeam/sdk/react`.
- Mount it above your router if the transcript should survive page navigation.

## Authentication

Your server must authenticate the host session and mint a chat token before the widget can chat. Keep the API key server-only. See [Authentication](https://app.astralbeam.ai/docs/sdk/authentication).

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
  return Response.json({ token }, { headers: { "cache-control": "no-store" } })
}
```

- Authenticate once and derive stable `user.id` and `tenant.id` values from that trusted session.
- Keep API keys server-only. Tokens are signed, not encrypted, so their claims must contain no secrets.
- Return `Cache-Control: no-store` and fail closed when configuration or authentication is missing.
- Tokens use the organization UUID as issuer and `astralbeam` as audience. The SDK renews them in memory before expiry.

## Customization

All props can change in place through React or the vanilla handle's `update(options)`. Use `reset()` for a fresh transcript and `stop()` to stop generation.

- Set `apiUrl` to your self-hosted API base, including `/api`.
- Choose `agentId`, header copy, color scheme, and theme tokens through [Configuration](https://app.astralbeam.ai/docs/sdk/configuration).
- Register host tools and inline widgets through [Tools and widgets](https://app.astralbeam.ai/docs/sdk/tools-and-widgets). Validate agent-chosen input before executing it.

## Documentation

| Guide                                                                     | Covers                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------- |
| [API client](https://app.astralbeam.ai/docs/sdk/api)                      | Typed resource and chat requests with API keys or JWTs. |
| [Getting started](https://app.astralbeam.ai/docs/sdk/getting-started)     | install, mount, layout requirements.                    |
| [Authentication](https://app.astralbeam.ai/docs/sdk/authentication)       | the token endpoint and its security rules.              |
| [Configuration](https://app.astralbeam.ai/docs/sdk/configuration)         | every option, and what `update` can change.             |
| [Theming](https://app.astralbeam.ai/docs/sdk/theming)                     | color schemes, CSS tokens, the shadow-root boundary.    |
| [Tools and widgets](https://app.astralbeam.ai/docs/sdk/tools-and-widgets) | schemas, live state, rendering into the transcript.     |
| [Attachments](https://app.astralbeam.ai/docs/sdk/attachments)             | file kinds, limits, what the endpoint enforces.         |
| [Limits](https://app.astralbeam.ai/docs/sdk/limits)                       | request, attachment, and sandbox limits.                |
| [Sandbox](https://app.astralbeam.ai/docs/sdk/sandbox)                     | steps, the opt-in panel, downloads, inline images.      |
| [Headless](https://app.astralbeam.ai/docs/sdk/headless)                   | own the whole chat UI on the same session.              |
| [Security model](https://app.astralbeam.ai/docs/sdk/security)             | who grants, who enforces, what the client can change.   |

## Entry points

There is no root export. Conversation history is not built yet.

| Entry point              | Contents                                     | Peer dependency      |
| ------------------------ | -------------------------------------------- | -------------------- |
| `@astralbeam/sdk/client` | `mountAstralBeamChat`, the vanilla loader    | none                 |
| `@astralbeam/sdk/core`   | `createAstralBeamChat`, the headless session | none                 |
| `@astralbeam/sdk/react`  | `<AstralBeamChat>`, `useAstralBeamChat`      | `react`, `react-dom` |
| `@astralbeam/sdk/server` | `createAstralBeamToken`, the token minter    | none                 |
| `@astralbeam/sdk/api`    | Resource and chat HTTP helpers               | none                 |

Requires TypeScript 5.0 or later, including when using classic `"moduleResolution": "node"`.

## Example

[`examples/todos`](../examples/todos) embeds the sidebar in a minimal TanStack Start app: a demo token route, host tools over live React state, and a `todoCard` widget. It uses no Tailwind or shadcn/ui of its own, to show the shadow-root boundary.

## License

[MIT](./LICENSE)
