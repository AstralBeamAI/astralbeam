# @astralbeam/sdk

Embed an agent chat sidebar or read-only tenant directories in your web app, or build your own chat UI with the headless core. The widgets isolate their styles in shadow roots.

```sh
npm install @astralbeam/sdk
```

## Quick start

One component in React, one function everywhere else. Full setup, including the required token endpoint, is in [Getting started](https://astralbeam.ai/docs/sdk/getting-started).

```tsx
import { AstralBeamChat } from "@astralbeam/sdk/react"

export function Sidebar() {
  return (
    <aside style={{ height: "100dvh" }}>
      <AstralBeamChat />
    </aside>
  )
}
```

```ts
import { mountAstralBeamChat } from "@astralbeam/sdk/client"

const handle = mountAstralBeamChat(document.getElementById("sidebar")!, {})
// Update with handle.update({ colorScheme: "dark" }), then clean up with handle.unmount().
```

Without npm or a bundler, import the same entry from jsDelivr in a module script. Pin an exact version and the full `/dist/client.js` path, because the loader imports its lazy chunks relative to itself. See [Script tag](https://astralbeam.ai/docs/sdk/script-tag).

```html
<div id="sidebar" style="height:100dvh"></div>
<script type="module">
  import { mountAstralBeamChat } from "https://cdn.jsdelivr.net/npm/@astralbeam/sdk@0.25.0/dist/client.js"

  mountAstralBeamChat(document.getElementById("sidebar"), {})
</script>
```

- Chat resizes horizontally and fills its parent's height. Give it a definite height (`min-h-0` in a flex column) and flexible width.
- Chat uses the hosted cloud by default. Tokens come from your application. For self-hosting, set `apiUrl` to your deployment’s `/api` base.
- `@astralbeam/sdk/client` ships no React. The chat loads as a lazy chunk with its own bundled copy.
- No runtime dependencies. `react` and `react-dom` are optional peers used only by `@astralbeam/sdk/react`.
- Mount it above your router if the transcript should survive page navigation.

## Authentication

Your server must authenticate the host session and mint a chat token before the widget can chat. Keep the API key server-only. See [Authentication](https://astralbeam.ai/docs/sdk/authentication).

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
- Directory access additionally requires signed `user.admin: true`, derived from trusted tenant permissions, and persisted records. Follow [Tenant directories](https://astralbeam.ai/docs/sdk/listings).
- For employee-facing Tenant management, use `createAstralBeamOrganizationToken`. The [API client guide](https://astralbeam.ai/docs/sdk/api) covers database-backed roles and browser integration.

After acquiring a token, components call `POST /api/v1/me` and renew before expiry. See [authentication and refresh behavior](https://astralbeam.ai/docs/sdk/authentication).

## Options

Pass options as React props or apply a subset with `handle.update(options)`. Presentation changes preserve chat. Changing `threadId` selects a conversation, and changing `apiUrl` clears the previous deployment's state. See [Configuration](https://astralbeam.ai/docs/sdk/configuration) for all options, defaults, layout, and chrome slots.

Most embeds let `<AstralBeamChat {...options} />` manage the session. For external controls, create `chat` with `useAstralBeamChat(options)` and render `<AstralBeamChat chat={chat} />`. Configure authentication and tools on the hook, with widgets and appearance on the view. Call actions directly on `chat` and read state through `chat.getState()`.

**Migration:** replace chat refs and mount-handle commands with session actions. Use `chat` instead of `chat.core`, and `chat.getState()` instead of snapshot fields. Directory handles are unchanged. See Configuration for ownership and JavaScript usage.

Conversations are saved automatically and start private. The widget searches saved conversation titles. Reopening history does not execute earlier tool calls. Disconnecting can interrupt the current response.

The headless session exposes conversation navigation, search, and pagination. With `useAstralBeamChat`, access these through `chat`, for example `chat.openThread(threadId)`. History loads a page at a time. `reset()` starts a new chat and keeps the saved one.

Download an attachment with `chat.getThreadAttachment({ threadId, fileId })`, which returns a `Blob`. Organization and participant tenant scope come from your credentials. Administrative downloads also pass `tenantId`. Use `{ preview: true }` as the second argument for a thumbnail. Only previews of your unsent uploads may omit `threadId`.

By default, `threadId: "auto"` restores this tab's selection after reload using session storage, scoped to the current account, API, and `placementKey ?? agentId ?? "default"`. Use distinct placement keys for independent chats with the same agent. A fresh, independently opened tab starts a new chat. Use `threadId: "new"` to bypass restoration, or pass a saved thread UUID. The widget keeps unsent text and uploaded file references in local storage per placement, account, API, and conversation. Reopening restores the draft without sending it automatically. The host owns sidebar visibility and can persist it separately in session storage.

## Tools and widgets

A tool does something: its `execute` runs in your page. A widget shows something: its `render` draws your UI into the conversation. Both are declared with a `description` and a `parameters` schema. See [Tools and widgets](https://astralbeam.ai/docs/sdk/tools-and-widgets).

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
- Return plain JSON values from tools, with no `undefined` fields. If a result cannot be sent, the action may still have happened.

## MCP connections

Remote tools appear under **MCP connections** in the authenticated Tenant widget. Organization admins configure the available MCP servers. Each TenantUser creates their own connection to a server. Public endpoints, static headers and OAuth are supported. Tool results follow the conversation's visibility and retention rules. Disconnect removes the saved connection and its credentials from AstralBeam.

Headless consumers can use `chat.getMcpCatalog()`, `chat.manageMcpConnection(operation)` and `chat.authorizeMcpConnection({ mcpServerId, id? })`. Start OAuth from a user gesture to open its popup. Browser binding and completion use the authenticated session. Server tool titles arrive in `state.serverToolTitles`, independently of host tool execution.

Reuse the dashboard's server list and form with `AstralBeamMcpServers` from `/react` or `mountAstralBeamMcpServers` from `/client`. Supply the server list and authorized write callbacks. See [MCP server management](https://astralbeam.ai/docs/sdk/configuration#mcp-server-management).

## Documentation

| Guide | Covers |
| --- | --- |
| [API client](https://astralbeam.ai/docs/sdk/api) | Typed resource and chat requests with API keys or JWTs. |
| [Getting started](https://astralbeam.ai/docs/sdk/getting-started) | install, mount, layout requirements. |
| [Script tag](https://astralbeam.ai/docs/sdk/script-tag) | loading from jsDelivr without a bundler, and Ruby on Rails. |
| [Authentication](https://astralbeam.ai/docs/sdk/authentication) | the token endpoint, its security rules, and minting in other languages. |
| [Tenant directories](https://astralbeam.ai/docs/sdk/listings) | provisioning, Tenant and user listings, saved conversation browsing, lifecycle, and options. |
| [Configuration](https://astralbeam.ai/docs/sdk/configuration) | every option, and what `update` can change. |
| [Theming](https://astralbeam.ai/docs/sdk/theming) | color schemes, CSS tokens, the shadow-root boundary. |
| [Tools and widgets](https://astralbeam.ai/docs/sdk/tools-and-widgets) | schemas, live state, rendering into the transcript. |
| [Attachments](https://astralbeam.ai/docs/sdk/attachments) | file kinds, limits, what the endpoint enforces. |
| [Limits](https://astralbeam.ai/docs/sdk/limits) | request, attachment, and sandbox limits. |
| [Sandbox](https://astralbeam.ai/docs/sdk/sandbox) | steps, the opt-in panel, downloads, inline images. |
| [Headless](https://astralbeam.ai/docs/sdk/headless) | own the whole chat UI on the same session. |
| [Security model](https://astralbeam.ai/docs/sdk/security) | who grants, who enforces, what the client can change. |

## Entry points

Read-only Tenant, TenantUser and conversation widgets are available from `/client` and `/react`. See [Tenant directories](https://astralbeam.ai/docs/sdk/listings) for setup and embedding examples.

React directory refs expose `refresh()` and `reset()`, both returning `Promise<void>`. Use props for updates and conditional rendering to unmount. Vanilla handles also expose `update()` and `unmount()`. Unmount during sign-out or identity changes. See the <a href="https://astralbeam.ai/docs/sdk/listings#account-changes-and-lifecycle" target="_blank" rel="noopener noreferrer">lifecycle contract</a> for authentication, caching, remount reuse, and action completion.

There is no root export.

| Entry point              | Contents                                     | Peer dependency      |
| ------------------------ | -------------------------------------------- | -------------------- |
| `@astralbeam/sdk/client` | Chat, directory, and MCP server mounts       | none                 |
| `@astralbeam/sdk/core`   | `createAstralBeamChat`, the headless session | none                 |
| `@astralbeam/sdk/react`  | Chat hooks and isolated UI wrappers          | `react`, `react-dom` |
| `@astralbeam/sdk/server` | Tenant and organization token minters        | none                 |
| `@astralbeam/sdk/api`    | Resource and chat HTTP helpers               | none                 |

Types resolve under every TypeScript module resolution mode, including classic `"moduleResolution": "node"`. Requires TypeScript 5.0 or later because declarations use `const` type parameters, which fail to parse on TypeScript 4.x.

## Examples

[`examples/linearity-react`](../examples/linearity-react) is a TanStack Start and shadcn/ui project tracker with two workspaces, localStorage persistence, and an assistant named Astro. It demonstrates validated tools, live issue cards, tenant switching, and a Basic Auth gate for a hosted playground.

[`examples/todos`](../examples/todos) embeds the sidebar and a tenant-scoped user listing in a minimal TanStack Start app. Both use the same demo token route. The app also demonstrates host tools over live React state and a `todoCard` widget, with no Tailwind or shadcn/ui of its own.

[`examples/todos-rails`](../examples/todos-rails) is the same app in Ruby on Rails 8. It loads the SDK from jsDelivr through an import map, mounts it from a plain ES module, mints tokens with the `jwt` gem, and gives the agent tools over the app's JSON API.

## License

[MIT](./LICENSE)
