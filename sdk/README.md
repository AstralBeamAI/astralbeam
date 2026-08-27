# @astralbeam/sdk

Frontend SDK for [AstralBeam](https://astralbeam.ai): drop-in, fully-customizable agent UI with managed chat streaming, conversation history, and observability.

> Work in progress: the chat streams from a real agent endpoint (an AstralBeam webapp exposing `/api/chat`), with optional host-backed authentication, streaming messages, tool calls executed in the host page, in-chat questionnaires, and host-rendered widgets. Conversation history is not built yet.

## Installation

```sh
npm install @astralbeam/sdk
```

## Usage

### Vanilla (any web app)

`@astralbeam/sdk/client` is a tiny framework-agnostic loader with no dependencies of its own; the React-based chat widget is bundled into a lazily loaded chunk, so the host page does not need React.

```ts
import { mountAstralBeamChat } from "@astralbeam/sdk/client"

const sidebar = document.getElementById("sidebar")
const handle = mountAstralBeamChat(sidebar, {
  title: "Dashboard assistant", // name in the widget header (default "AstralBeam")
  showHeader: true, // header with the title and the reset button (default true)
  emptyTitle: "Ask the dashboard assistant", // headline on the empty transcript
  emptyDescription: "It can restart services and open dashboards for you.", // subtitle under it
  chatEndpoint: "https://myapp.example/api/chat", // AstralBeam chat endpoint (default "/api/chat")
  authEndpoint: "/api/astralbeam/token", // host endpoint minting the chat token (required today)
  systemPrompt: "You are the assistant of an infrastructure dashboard.",
  colorScheme: "system", // "light" | "dark" | "system" (default)
  theme: {
    // custom values for the widget's theming CSS variables (all optional)
    light: { "--primary": "#b4762a", "--radius": "0px" },
    dark: { "--primary": "#d99a45" },
  },
  attachments: { maxFiles: 3 }, // file attachments in the composer (on by default; false to hide)
  debug: false, // log every SDK and endpoint action to the consoles (default false)
  tools: {
    restart_service: {
      metadata: { title: "Restart a service" }, // transcript label; defaults to the tool's name
      description: "Restart one of the host app's services by name",
      parameters: {
        type: "object",
        properties: { service: { type: "string" } },
        required: ["service"],
      },
      execute: async ({ service }) => await restartService(String(service)),
    },
  },
  widgets: {
    systemStatus: {
      description: "Shows the current status of the host app's systems",
      parameters: {
        type: "object",
        properties: { degraded: { type: "boolean" } },
      },
      render: (props, container) => {
        container.textContent = props.degraded ? "Degraded performance" : "All systems operational"
      },
    },
  },
})
// later: handle.update({ colorScheme: "dark", widgets: nextWidgets }), handle.unmount()
```

The chat widget renders inside a shadow root on the mount target, so its styles never leak into (or absorb from) the host page. It streams the conversation from the `chatEndpoint` (an AstralBeam webapp's `/api/chat`), forwarding the optional `systemPrompt` for the endpoint to append to the agent's instructions. When `authEndpoint` is present, the widget obtains a short-lived bearer token before enabling its composer and renews it in memory as needed. The AstralBeam endpoint currently answers unauthenticated runs with `401`, so `authEndpoint` is required in practice. The `title` option names the assistant in the widget's header, and `showHeader: false` hides that header — title and reset button both — giving the transcript the widget's full height. The `emptyTitle` and `emptyDescription` options replace the headline and subtitle the empty transcript shows before the first message. Assistant replies are rendered as Markdown (headings, lists, tables, links, and fenced code) with [TanStack Markdown](https://tanstack.com/markdown), using its streaming profile so a partial reply stays stable as it arrives; raw HTML in a reply is escaped and executable link protocols are dropped. The `colorScheme` option picks the widget's color scheme — `"system"` (the default) follows the OS `prefers-color-scheme` setting live. The `theme` option overrides the widget's theming CSS variables — the [shadcn/ui tokens](https://ui.shadcn.com/docs/theming) such as `--background`, `--primary`, `--radius`, and the `--font-sans`/`--font-heading`/`--font-mono` font stacks — per color scheme: mirroring shadcn's `:root`/`.dark` split, `theme.light` is the base applied in both schemes and `theme.dark` overrides it when the resolved scheme is dark.

### Attachments

The composer takes files by default: through the paperclip button, by dropping them on the composer, or by pasting them (a pasted screenshot lands as an image). Each file appears as a chip above the input, removable before the message is sent and shown again with the message in the transcript, where clicking one downloads the file. Images and PDFs go to the model as-is; a text file (`.md`, `.csv`, `.json`, source files, ...) is read as text by the endpoint, which labels it with its filename. A file the widget cannot send keeps its chip and says why, and one the endpoint cannot use is explained to the agent in the conversation rather than failing the run — so the assistant can tell the user. Files are sent inline with the message, and stay in the conversation's context for the rest of the run.

Set `attachments: false` to hide the feature entirely, or pass an options object to narrow it:

| Option          | Default                                    | Meaning                                                                      |
| --------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| `enabled`       | `true`                                     | `false` is the same as `attachments: false`                                  |
| `maxFiles`      | `5`                                        | Files per message                                                            |
| `maxFileBytes`  | per kind: 5 MB image, 10 MB PDF, 1 MB text | Ceiling for one file; the per-kind caps still apply, so the smaller one wins |
| `maxTotalBytes` | 20 MB                                      | Ceiling for all files on one message                                         |
| `accept`        | everything supported                       | MIME types or `type/*` patterns, e.g. `["image/*"]` for images only          |

The endpoint enforces the same size and type limits independently, so narrowing them in the widget is a UI affordance rather than a security boundary.

`handle.update(options)` replaces any subset of the mount options in place, keeping the transcript, the chat session, and live widget renders: rename the assistant, retheme it alongside the host app, revise the `systemPrompt`, retune or disable `attachments`, register or drop `tools` and `widgets`, or turn `debug` on mid-conversation. Newly declared tools and widgets reach the agent on its next run. `chatEndpoint` and `authEndpoint` are fixed at mount because they construct the transport. Dropping a widget disposes any render of it still in the transcript, which falls back to a summary marker.

With `debug: true` (also available as a prop on `<AstralBeamChat>`), every SDK action — mounting, theming, sends, streamed messages and reasoning, tool calls and their host-side executions, widget renders, questionnaire answers, errors — is logged to the browser console with UTC timestamps and full payloads, and the endpoint is asked to log its side of the same run to the server console, so a conversation can be followed end to end.

The agent acts on the host app through **tools** and **widgets**, both keyed by name and declared to the agent with a `description` and a `parameters` schema — either a plain JSON Schema object as above or any [Standard Schema](https://standardschema.dev) validator (Zod, Valibot, ArkType, ...), with no validator dependency required. A Standard Schema is also enforced client-side, validating the agent-chosen input before host code runs; with a plain JSON Schema, treat the input as untrusted. A tool's `execute` runs in the host page and its resolved value streams back to the agent as the tool result. Every tool call becomes one line in the transcript that expands to show the call's input and output as JSON; a tool's `metadata`, forwarded verbatim to the tool definition, labels that line with its `title` in place of the registry name. A widget's `render` draws host UI into the conversation: the SDK creates a light-DOM child of the mount target, calls `render(props, container)` on it, and projects it into the transcript through a named `<slot>`; `render` may return a cleanup function.

Widget renders pick up the host page's typography and custom properties automatically. That needs help, because slotted content inherits through the [flattened tree](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scoping), whose parent for a render is the `<slot>` inside the chat's shadow root — so a render would otherwise inherit the chat's own font and colors, and resolve `var(--card)` against the chat's token of that name instead of yours. The SDK writes one rule into the chat's shadow root giving every widget slot the page's computed value for each inherited CSS property, plus every custom property declared in the page's stylesheets, and re-reads it when a theme class changes on an ancestor. Your own selectors match a render normally and override the mirrored values, so styling a widget is ordinary CSS with no slot-specific rules. Two limits: properties are read from the mount target's parent, so rules targeting the mount target itself are not picked up, and tokens declared only in a cross-origin stylesheet cannot be read.

### Authentication

Supply `authEndpoint`; the AstralBeam endpoint serves signed-in users only for now and rejects a run with no token, so a widget without it can stream nothing. The host endpoint must authenticate the application's existing session, load the active user and tenant from trusted server-side state, and return `{ "token": "..." }`. The SDK calls it with `POST`, `credentials: "include"`, and `cache: "no-store"`, keeps the token only in memory, refreshes it within one minute of expiry, and retries one rejected chat request with a fresh token. A configured endpoint fails closed: its loading or error state disables the composer instead of falling back to guest chat.

Use the server entry to mint the token without exposing the signing secret to browser code:

```ts
import { createAstralBeamChatToken } from "@astralbeam/sdk/server"

export async function POST(request: Request) {
  const session = await requireApplicationSession(request)
  const token = await createAstralBeamChatToken({
    secret: process.env.ASTRALBEAM_CHAT_AUTH_SECRET!,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      avatarUrl: session.user.avatarUrl,
    },
    tenant: {
      id: session.tenant.id,
      name: session.tenant.name,
      logoUrl: session.tenant.logoUrl,
    },
  })
  return Response.json({ token }, { headers: { "cache-control": "no-store" } })
}
```

The default lifetime is five minutes and the helper rejects lifetimes above ten minutes, weak secrets, missing IDs, and invalid profile URLs. User and tenant IDs are required; names, email, avatar, and logo are optional display metadata. Tokens use the temporary global issuer and key ID while AstralBeam has no application accounts. Because every integrator temporarily shares the verifier secret, these tokens must not authorize persisted tenant data, billing, or server-side actions until per-application keys are introduced.

### React

`@astralbeam/sdk/react` wraps the vanilla client in an `<AstralBeamChat>` component. It requires the `react` and `react-dom` peer dependencies (already present in any React app):

```sh
npm install @astralbeam/sdk react react-dom
```

Render `<AstralBeamChat>` wherever the chat sidebar should appear; it fills its container's height, mounts the chat widget on mount, and unmounts it on cleanup. The `title`, `showHeader`, `emptyTitle`, `emptyDescription`, `chatEndpoint`, `authEndpoint`, `systemPrompt`, and `tools` props work like the vanilla options (tool `execute` calls always reach the latest prop value, so they can close over current component state). The `colorScheme` prop (`"light" | "dark" | "system"`, default `"system"`) picks the color scheme, the `theme` prop overrides the widget's theming CSS variables per scheme, and the `attachments` prop configures or disables composer attachments — all like the vanilla options. Every prop except the fixed `chatEndpoint` and `authEndpoint` applies immediately on change — the wrapper forwards them to `handle.update` from an effect. Register widgets through the `widgets` prop — the same tool-definition shape as the vanilla client, except `render` returns JSX instead of drawing into a container. The agent reads each `description` and `parameters` to decide when to render a widget and with which props. Rendered widgets live in your app's React tree and are projected into the chat through slots, so state, context, and event handlers keep working:

```tsx
import { AstralBeamChat } from "@astralbeam/sdk/react"

export function Sidebar() {
  return (
    <AstralBeamChat
      widgets={{
        systemStatus: {
          description: "Shows the current status of the host app's systems",
          parameters: {
            type: "object",
            properties: { degraded: { type: "boolean" } },
          },
          render: ({ degraded }) => <StatusCard degraded={Boolean(degraded)} />,
        },
      }}
    />
  )
}
```

The chat widget itself loads as a separate lazy chunk with its own bundled React copy and renders in a shadow root, so it neither depends on nor conflicts with your app's React version or styles. Only the thin `<AstralBeamChat>` wrapper and your widget `render` functions run on your app's React.

## Entry points

- `@astralbeam/sdk/client` — framework-agnostic browser client
- `@astralbeam/sdk/server` — server-side token helpers
- `@astralbeam/sdk/react` — React components (e.g. `<AstralBeamChat />`), requires the `react` and `react-dom` peer dependencies
- `@astralbeam/sdk/vue` — Vue components, requires the `vue` peer dependency (placeholder)

## Examples

[`examples/todos`](../examples/todos) is a minimal TanStack Start todos app that embeds the chat sidebar from the built package, authenticates a fixed demo identity through a server route, points the chat at a locally running webapp's `/api/chat`, and registers a todo-specific system prompt, `get_todos`/`create_todo`/`update_todo`/`delete_todo` tools, and a `todoCard` widget the agent renders into the conversation once per todo it shows — with no Tailwind or shadcn/ui of its own, to demonstrate the shadow-root style boundary.

## Architecture

[ARCHITECTURE.md](./ARCHITECTURE.md) explains how the SDK is put together: the entry-point layout, the embedded-React chat widget, the shadow-root and slot boundary between chat and host, and the two-pass build.

## License

[MIT](./LICENSE)
