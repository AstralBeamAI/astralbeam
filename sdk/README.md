# @astralbeam/sdk

Frontend SDK for [AstralBeam](https://astralbeam.ai): drop-in, fully-customizable agent UI with managed chat streaming, conversation history, and observability.

> Work in progress: the chat streams from a real agent endpoint (an AstralBeam webapp exposing `/api/chat`), with streaming messages, tool calls executed in the host page, in-chat questionnaires, and host-rendered widgets. Authentication and conversation history are not built yet.

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
  endpoint: "https://myapp.example/api/chat", // AstralBeam chat endpoint (default "/api/chat")
  systemPrompt: "You are the assistant of an infrastructure dashboard.",
  theme: "system", // "light" | "dark" | "system" (default)
  debug: false, // log every SDK and endpoint action to the consoles (default false)
  tools: {
    restart_service: {
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
// later: handle.setTheme("dark"), handle.unmount()
```

The chat widget renders inside a shadow root on the mount target, so its styles never leak into (or absorb from) the host page. It streams the conversation from the `endpoint` (an AstralBeam webapp's `/api/chat`), forwarding the optional `systemPrompt` for the endpoint to append to the agent's instructions. The `theme` option picks the widget's color scheme — `"system"` (the default) follows the OS `prefers-color-scheme` setting live, and `handle.setTheme` switches it later, e.g. when the host app's own theme toggles.

With `debug: true` (also available as a prop on `<AstralBeamChat>`), every SDK action — mounting, theming, sends, streamed messages and reasoning, tool calls and their host-side executions, widget renders, questionnaire answers, errors — is logged to the browser console with UTC timestamps and full payloads, and the endpoint is asked to log its side of the same run to the server console, so a conversation can be followed end to end.

The agent acts on the host app through **tools** and **widgets**, both keyed by name and declared to the agent with a `description` and a `parameters` schema — either a plain JSON Schema object as above or any [Standard Schema](https://standardschema.dev) validator (Zod, Valibot, ArkType, ...), with no validator dependency required. A Standard Schema is also enforced client-side, validating the agent-chosen input before host code runs; with a plain JSON Schema, treat the input as untrusted. A tool's `execute` runs in the host page and its resolved value streams back to the agent as the tool result. A widget's `render` draws host UI into the conversation: the SDK creates a light-DOM child of the mount target, calls `render(props, container)` on it, and projects it into the transcript through a named `<slot>`; `render` may return a cleanup function.

### React

`@astralbeam/sdk/react` wraps the vanilla client in an `<AstralBeamChat>` component. It requires the `react` and `react-dom` peer dependencies (already present in any React app):

```sh
npm install @astralbeam/sdk react react-dom
```

Render `<AstralBeamChat>` wherever the chat sidebar should appear; it fills its container's height, mounts the chat widget on mount, and unmounts it on cleanup. The `endpoint`, `systemPrompt`, and `tools` props work like the vanilla options (tool `execute` calls always reach the latest prop value, so they can close over current component state). The `theme` prop (`"light" | "dark" | "system"`, default `"system"`) picks the color scheme, and prop changes apply immediately. Register widgets through the `widgets` prop — the same tool-definition shape as the vanilla client, except `render` returns JSX instead of drawing into a container. The agent reads each `description` and `parameters` to decide when to render a widget and with which props. Rendered widgets live in your app's React tree and are projected into the chat through slots, so state, context, and event handlers keep working:

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
- `@astralbeam/sdk/server` — server-side helpers (placeholder)
- `@astralbeam/sdk/react` — React components (e.g. `<AstralBeamChat />`), requires the `react` and `react-dom` peer dependencies
- `@astralbeam/sdk/vue` — Vue components, requires the `vue` peer dependency (placeholder)

## Examples

[`examples/todos`](./examples/todos) is a minimal Vite + React todos app that embeds the chat sidebar from the built package, points it at a locally running webapp's `/api/chat`, and registers a todo-specific system prompt, `list_todos`/`add_todo`/`set_todo_completed` tools, and a `todoCard` widget the agent renders into the conversation — with no Tailwind or shadcn/ui of its own, to demonstrate the shadow-root style boundary.

## Architecture

[ARCHITECTURE.md](./ARCHITECTURE.md) explains how the SDK is put together: the entry-point layout, the embedded-React chat widget, the shadow-root and slot boundary between chat and host, and the two-pass build.

## License

[MIT](./LICENSE)
