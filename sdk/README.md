# @astralbeam/sdk

Embed an agent chat sidebar or read-only tenant directories in your web app, or build your own chat UI with the headless core. The widgets isolate their styles in shadow roots.

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

Without npm or a bundler, import the same entry from jsDelivr in a module script. Pin an exact version and the full `/dist/client.js` path, because the loader imports its lazy chunks relative to itself. See [Script tag](https://app.astralbeam.ai/docs/sdk/script-tag).

```html
<script type="module">
  import { mountAstralBeamChat } from "https://cdn.jsdelivr.net/npm/@astralbeam/sdk@0.13.5/dist/client.js"

  mountAstralBeamChat(document.getElementById("sidebar"), {})
</script>
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

- Authenticate once and derive stable `user.id` and `tenant.id` values from that trusted session.
- Keep API keys server-only. Tokens are signed, not encrypted, so their claims must contain no secrets.
- Return `Cache-Control: no-store` and fail closed when configuration or authentication is missing.
- Directory access additionally requires signed `user.admin: true`, derived from trusted tenant permissions, and persisted records. Follow [Tenant directories](https://app.astralbeam.ai/docs/sdk/listings).
- For employee-facing Tenant management, use `createAstralBeamOrganizationToken`. The [API client guide](https://app.astralbeam.ai/docs/sdk/api) covers database-backed roles and browser integration.

Existing token props and the default chat endpoint keep working. After acquiring a token, components call `POST /api/v1/me` and renew before expiry. See [authentication and refresh behavior](https://app.astralbeam.ai/docs/sdk/authentication).

## Options

Every option is also a prop on `<AstralBeamChat>`. `handle.update(options)` applies any subset in place, and no option is fixed at mount. Details in [Configuration](https://app.astralbeam.ai/docs/sdk/configuration).

| Option | Default | Meaning |
| --- | --- | --- |
| `agentId` | organization's default | `agent_<orgId>_<id>`, copied from the dashboard |
| `apiUrl` | `https://app.astralbeam.ai/api` | Base URL of the AstralBeam API. The widget calls `/v1/chat` there |
| `fetchAstralBeamToken` | `{ url: "/api/astralbeam/token" }` | Chat auth token endpoint as `{ url, ...RequestInit }`, or a minter |
| `title`, `showHeader` | `"AstralBeam"`, `true` | Header text, and whether the header and reset button show |
| `emptyTitle`, `emptyDescription` | generic copy | Headline and subtitle of the empty transcript |
| `colorScheme`, `theme` | `"system"`, built-in palette | Light/dark/system, and shadcn token overrides |
| `customCss` | None | Trusted CSS inside the widget's Shadow DOM |
| `attachments` | `true` | `false` hides the feature, or pass limits |
| `tools`, `widgets` | none | What the agent can do and draw in your app |
| `sandboxPanel` | `false` | Collected sandbox panel: files with downloads, command log |
| `header`, `empty`, `composerActions` | widget's own chrome | Host-rendered replacements (React props. `slots` on the handle) |
| `debug` | `false` | Log SDK actions in the browser, with server logs in development only |

A `ref` on `<AstralBeamChat>` (and the vanilla handle) exposes `reset()` and `stop()` for hosts that draw their own controls.

## Tools and widgets

A tool does something: its `execute` runs in your page. A widget shows something: its `render` draws your UI into the conversation. Both are declared with a `description` and a `parameters` schema. See [Tools and widgets](https://app.astralbeam.ai/docs/sdk/tools-and-widgets).

```tsx
tools: {
  restart_service: {
    metadata: { title: "Restart a service" },
    description: "Restart one of the host app's services by name",
    parameters: { type: "object", properties: { service: { type: "string" } }, required: ["service"] },
    execute: async ({ service }) => await restartService(String(service)),
  },
},
widgets: {
  systemStatus: {
    description: "Shows the current status of the host app's systems",
    parameters: { type: "object", properties: { degraded: { type: "boolean" } } },
    render: ({ degraded }) => <StatusCard degraded={Boolean(degraded)} />,
  },
}
```

- Schemas are plain JSON Schema, or any [Standard Schema](https://standardschema.dev) validator (Zod, Valibot, ArkType).
- Only a Standard Schema validates input in the browser. With plain JSON Schema, treat input as untrusted.

## Documentation

| Guide | Covers |
| --- | --- |
| [API client](https://app.astralbeam.ai/docs/sdk/api) | Typed resource and chat requests with API keys or JWTs. |
| [Getting started](https://app.astralbeam.ai/docs/sdk/getting-started) | install, mount, layout requirements. |
| [Script tag](https://app.astralbeam.ai/docs/sdk/script-tag) | loading from jsDelivr without a bundler, and Ruby on Rails. |
| [Authentication](https://app.astralbeam.ai/docs/sdk/authentication) | the token endpoint, its security rules, and minting in other languages. |
| [Tenant directories](https://app.astralbeam.ai/docs/sdk/listings) | provisioning, tenant-user and Tenant listings, lifecycle, and options. |
| [Configuration](https://app.astralbeam.ai/docs/sdk/configuration) | every option, and what `update` can change. |
| [Theming](https://app.astralbeam.ai/docs/sdk/theming) | color schemes, CSS tokens, the shadow-root boundary. |
| [Tools and widgets](https://app.astralbeam.ai/docs/sdk/tools-and-widgets) | schemas, live state, rendering into the transcript. |
| [Attachments](https://app.astralbeam.ai/docs/sdk/attachments) | file kinds, limits, what the endpoint enforces. |
| [Limits](https://app.astralbeam.ai/docs/sdk/limits) | request, attachment, and sandbox limits. |
| [Sandbox](https://app.astralbeam.ai/docs/sdk/sandbox) | steps, the opt-in panel, downloads, inline images. |
| [Headless](https://app.astralbeam.ai/docs/sdk/headless) | own the whole chat UI on the same session. |
| [Security model](https://app.astralbeam.ai/docs/sdk/security) | who grants, who enforces, what the client can change. |

## Entry points

Read-only Tenant and TenantUser widgets are available from `/client` and `/react`. See [Tenant directories](https://app.astralbeam.ai/docs/sdk/listings) for setup and embedding examples.

There is no root export. Conversation history is not built yet.

| Entry point              | Contents                                     | Peer dependency      |
| ------------------------ | -------------------------------------------- | -------------------- |
| `@astralbeam/sdk/client` | Chat and Tenant directory mounts             | none                 |
| `@astralbeam/sdk/core`   | `createAstralBeamChat`, the headless session | none                 |
| `@astralbeam/sdk/react`  | Chat hooks and isolated UI wrappers          | `react`, `react-dom` |
| `@astralbeam/sdk/server` | Tenant and organization token minters        | none                 |
| `@astralbeam/sdk/api`    | Resource and chat HTTP helpers               | none                 |

Types resolve under every TypeScript module resolution mode, including classic `"moduleResolution": "node"`. Requires TypeScript 5.0 or later because declarations use `const` type parameters, which fail to parse on TypeScript 4.x.

## Example

[`examples/todos`](../examples/todos) embeds the sidebar and a tenant-scoped user listing in a minimal TanStack Start app. Both use the same demo token route. The app also demonstrates host tools over live React state and a `todoCard` widget, with no Tailwind or shadcn/ui of its own.

[`examples/todos-rails`](../examples/todos-rails) is the same app in Ruby on Rails 8. It loads the SDK from jsDelivr through an import map, mounts it from a plain ES module, mints tokens with the `jwt` gem, and gives the agent tools over the app's JSON API.

## License

[MIT](./LICENSE)
