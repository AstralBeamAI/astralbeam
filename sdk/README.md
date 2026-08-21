# @astralbeam/sdk

Frontend SDK for [AstralBeam](https://astralbeam.ai): drop-in, fully-customizable agent UI with managed chat streaming, conversation history, and observability.

> Work in progress: the chat UI is real (streaming messages, reasoning, tool activity, in-chat questionnaires, and host-rendered custom components), but the agent behind it is simulated — a scripted conversation stands in until real LLM calls are integrated.

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
  customComponents: [{ description: "Shows the host app's current status" }],
  onRenderCustomComponent: ({ slotName }) => {
    const status = document.createElement("p")
    status.slot = slotName
    status.textContent = "All systems operational"
    sidebar.append(status)
  },
})
// later: handle.unmount()
```

The widget renders inside a shadow root on the mount target, so its styles never leak into (or absorb from) the host page. Host UI enters the widget through custom components: each entry's `description` tells the agent what the component does, and when the agent decides to render one (the current scripted agent renders the first registered component mid-conversation) it calls `onRenderCustomComponent`. The host draws the UI as a light-DOM child of the mount target with the requested `slot` attribute, and the widget projects it into place through a named `<slot>`.

### React

`@astralbeam/sdk/react` wraps the vanilla client in an `<AstralBeamChat>` component. It requires the `react` peer dependency (already present in any React app):

```sh
npm install @astralbeam/sdk react react-dom
```

Render `<AstralBeamChat>` wherever the chat sidebar should appear; it fills its container's height, mounts the widget on mount, and unmounts it on cleanup. Register your own components through `customComponents`: the agent reads each `description` to decide when to render the component and with which props (the current scripted agent renders the first entry mid-conversation). Requested components render in your app's React tree and are projected into the widget through slots, so state, context, and event handlers keep working:

```tsx
import { AstralBeamChat } from "@astralbeam/sdk/react"

export function Sidebar() {
  return (
    <AstralBeamChat
      customComponents={[
        {
          component: StatusCard,
          props: { status: "All systems operational" },
          description: "Shows the host app's current status",
        },
      ]}
    />
  )
}
```

The widget itself loads as a separate lazy chunk with its own bundled React copy and renders in a shadow root, so it neither depends on nor conflicts with your app's React version or styles. Only the thin `<AstralBeamChat>` wrapper runs on your app's React.

## Entry points

- `@astralbeam/sdk/client` — framework-agnostic browser client
- `@astralbeam/sdk/server` — server-side helpers (placeholder)
- `@astralbeam/sdk/react` — React components (e.g. `<AstralBeamChat />`), requires the `react` peer dependency
- `@astralbeam/sdk/vue` — Vue components, requires the `vue` peer dependency (placeholder)

## Examples

[`examples/todos`](./examples/todos) is a minimal Vite + React todos app that embeds the chat sidebar from the built package, toggles it from the host UI, and projects its own `TodoCard` component into the conversation — with no Tailwind or shadcn/ui of its own, to demonstrate the shadow-root style boundary.

## Architecture

[ARCHITECTURE.md](./ARCHITECTURE.md) explains how the SDK is put together: the entry-point layout, the embedded-React widget, the shadow-root and slot boundary between widget and host, and the two-pass build.

## License

[MIT](./LICENSE)
