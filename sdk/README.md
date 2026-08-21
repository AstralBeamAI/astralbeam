# @astralbeam/sdk

Frontend SDK for [AstralBeam](https://astralbeam.ai): drop-in, fully-customizable agent UI with managed chat streaming, conversation history, and observability.

> Work in progress: the chat UI is real (streaming messages, reasoning, tool activity, in-chat questionnaires, and host-rendered widgets), but the agent behind it is simulated — a scripted conversation stands in until real LLM calls are integrated.

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
// later: handle.unmount()
```

The chat widget renders inside a shadow root on the mount target, so its styles never leak into (or absorb from) the host page. Host UI enters the conversation through **widgets** — dynamic UI the agent can show, keyed by identifier. Each definition reads like a tool definition: the `description` tells the agent what the widget shows, `parameters` describes the props the agent may supply — either a plain JSON Schema object as above or any [Standard Schema](https://standardschema.dev) validator (Zod, Valibot, ArkType, ...), with no validator dependency required — and `render` draws the widget with the agent-chosen props. When the agent decides to render a widget (the current scripted agent renders the first registered one mid-conversation), the SDK creates a light-DOM child of the mount target, calls `render(props, container)` on it, and projects it into the conversation through a named `<slot>`; `render` may return a cleanup function.

### React

`@astralbeam/sdk/react` wraps the vanilla client in an `<AstralBeamChat>` component. It requires the `react` and `react-dom` peer dependencies (already present in any React app):

```sh
npm install @astralbeam/sdk react react-dom
```

Render `<AstralBeamChat>` wherever the chat sidebar should appear; it fills its container's height, mounts the chat widget on mount, and unmounts it on cleanup. Register widgets through the `widgets` prop — the same tool-definition shape as the vanilla client, except `render` returns JSX instead of drawing into a container. The agent reads each `description` and `parameters` to decide when to render a widget and with which props (the current scripted agent renders the first entry mid-conversation). Rendered widgets live in your app's React tree and are projected into the chat through slots, so state, context, and event handlers keep working:

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

[`examples/todos`](./examples/todos) is a minimal Vite + React todos app that embeds the chat sidebar from the built package, toggles it from the host UI, and registers a `todoCard` widget the agent renders into the conversation — with no Tailwind or shadcn/ui of its own, to demonstrate the shadow-root style boundary.

## Architecture

[ARCHITECTURE.md](./ARCHITECTURE.md) explains how the SDK is put together: the entry-point layout, the embedded-React chat widget, the shadow-root and slot boundary between chat and host, and the two-pass build.

## License

[MIT](./LICENSE)
