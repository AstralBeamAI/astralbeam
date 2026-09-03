# @astralbeam/sdk

A drop-in agent chat sidebar for your web app, from [AstralBeam](https://astralbeam.ai), with a headless core underneath when you want to own the UI. The widget renders in a shadow root so its styles never mix with yours, and it streams from an AstralBeam chat endpoint.

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
// handle.update({ colorScheme: "dark" }) — handle.unmount()
```

- The widget fills its container, so give it a parent with a definite height (`min-h-0` in a flex column).
- Two origins by design: chat streams to the hosted cloud by default, while the token comes from your own app's endpoint. Self-hosted deployments set `apiUrl` to their own origin.
- `@astralbeam/sdk/client` ships no React; the chat loads as a lazy chunk with its own bundled copy.
- `react` and `react-dom` are optional peer dependencies used only by `@astralbeam/sdk/react`.
- Mount it above your router if the transcript should survive page navigation.

## Authentication

The widget will not chat until your app mints it a short-lived token; it never sees your API key. See [Authentication](https://app.astralbeam.ai/docs/sdk/authentication).

```ts
import { createAstralBeamTokenRoute } from "@astralbeam/sdk/server"

export const POST = createAstralBeamTokenRoute({
  apiKey: () => process.env.ASTRALBEAM_API_KEY, // key_<organization>_<key>_abo_<secret>
  authenticate: (request) => getApplicationSession(request),
  user: (session) => ({
    id: session.user.id,
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

- Add one endpoint, `/api/astralbeam/token` by default, that authenticates your own session first.
- The factory owns the method check, the unconfigured 503, the unauthenticated 401, and `no-store`.
- Authenticate once, then derive `user` and `tenant` separately from that same application session.
- Derive `user` and `tenant` from trusted server-side state, never from anything the browser sent.
- Provide stable tenant-local `user.id` and stable `tenant.id` values; names are optional, and set `user.admin` only from trusted state.
- Put custom tenant and tenant-user fields in their respective `metadata` JSON objects; never include secrets.
- SDK fields use camelCase; AstralBeam-owned JWT claims use snake_case, while `metadata` keys are preserved verbatim.
- Tokens use the API key's organization slug as issuer and the platform audience `astralbeam`; AstralBeam does not require or interpret `sub`.
- Tokens are signed, not encrypted: never put a secret in them.
- Lifetimes are 60–600 seconds; the SDK renews in memory before expiry.
- The widget POSTs `authTokenUrl` with the page's cookies; pass `authTokenHeaders` (an object, or a function for a rotating credential) when your backend is on another origin behind header auth.

## Options

Every option is also a prop on `<AstralBeamChat>`; `handle.update(options)` applies any subset in place. `agentId`, `apiUrl`, `authTokenUrl`, and `authTokenHeaders` are fixed at mount. Details in [Configuration](https://app.astralbeam.ai/docs/sdk/configuration).

| Option                               | Default                         | Meaning                                                         |
| ------------------------------------ | ------------------------------- | --------------------------------------------------------------- |
| `agentId`                            | organization's default          | `agt_<organization>_<agent>` from the dashboard                 |
| `apiUrl`                             | `https://app.astralbeam.ai/api` | Base URL of the AstralBeam API; the widget calls `/chat` there  |
| `authTokenUrl`                       | `/api/astralbeam/token`         | Your token endpoint                                             |
| `authTokenHeaders`                   | none                            | Extra token-request headers, for a backend on another origin    |
| `title`, `showHeader`                | `"AstralBeam"`, `true`          | Header text, and whether the header and reset button show       |
| `emptyTitle`, `emptyDescription`     | generic copy                    | Headline and subtitle of the empty transcript                   |
| `colorScheme`, `theme`               | `"system"`, built-in palette    | Light/dark/system, and shadcn token overrides                   |
| `attachments`                        | `true`                          | `false` hides the feature, or pass limits                       |
| `tools`, `widgets`                   | none                            | What the agent can do and draw in your app                      |
| `sandboxPanel`                       | `false`                         | Collected sandbox panel: files with downloads, command log      |
| `header`, `empty`, `composerActions` | widget's own chrome             | Host-rendered replacements (React props; `slots` on the handle) |
| `debug`                              | `false`                         | Log every SDK action in the browser and on the server           |

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
- Only a Standard Schema validates input in the browser; with plain JSON Schema, treat input as untrusted.
- `defineTool` and `defineWidget` type `execute`/`render` input from a Standard Schema's output.
- In React, `render` returns JSX in your own tree, so state, context, and handlers keep working.
- New tools and widgets reach the agent on its next run.

## Documentation

Each guide is short and self-contained.

- [Getting started](https://app.astralbeam.ai/docs/sdk/getting-started) — install, mount, layout requirements.
- [Authentication](https://app.astralbeam.ai/docs/sdk/authentication) — the token endpoint and its security rules.
- [Configuration](https://app.astralbeam.ai/docs/sdk/configuration) — every option, and what `update` can change.
- [Theming](https://app.astralbeam.ai/docs/sdk/theming) — color schemes, CSS tokens, the shadow-root boundary.
- [Tools and widgets](https://app.astralbeam.ai/docs/sdk/tools-and-widgets) — schemas, live state, rendering into the transcript.
- [Attachments](https://app.astralbeam.ai/docs/sdk/attachments) — file kinds, limits, what the endpoint enforces.
- [Sandbox](https://app.astralbeam.ai/docs/sdk/sandbox) — steps, the opt-in panel, downloads, inline images.
- [Headless](https://app.astralbeam.ai/docs/sdk/headless) — own the whole chat UI on the same session.
- [Security model](https://app.astralbeam.ai/docs/sdk/security) — who grants, who enforces, what the client can change.

## Entry points

There is no root export. Conversation history is not built yet.

| Entry point              | Contents                                                  | Peer dependency      |
| ------------------------ | --------------------------------------------------------- | -------------------- |
| `@astralbeam/sdk/client` | `mountAstralBeamChat`, the vanilla loader                 | none                 |
| `@astralbeam/sdk/core`   | `createAstralBeamChat`, the headless session              | none                 |
| `@astralbeam/sdk/react`  | `<AstralBeamChat>`, `useAstralBeamChat`                   | `react`, `react-dom` |
| `@astralbeam/sdk/server` | `createAstralBeamChatToken`, `createAstralBeamTokenRoute` | none                 |
| `@astralbeam/sdk/vue`    | Vue components (placeholder)                              | `vue`                |

Types resolve under every TypeScript module resolution mode, including the classic `"moduleResolution": "node"` that Ionic, Capacitor, and Create React App templates still ship. TypeScript 5.0 or later is required, because the declarations use `const` type parameters; on TypeScript 4.x the `.d.ts` files fail to parse.

## Example

[`examples/todos`](../examples/todos) embeds the sidebar in a minimal TanStack Start app: a demo token route, host tools over live React state, and a `todoCard` widget. It uses no Tailwind or shadcn/ui of its own, to show the shadow-root boundary.

## License

[MIT](./LICENSE)
