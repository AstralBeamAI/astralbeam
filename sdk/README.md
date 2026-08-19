# @astralbeam/sdk

Frontend SDK for [AstralBeam](https://astralbeam.ai): drop-in, fully-customizable agent UI with managed chat streaming, conversation history, and observability.

> Work in progress: the chat widget is currently a hello-world placeholder.

## Installation

```sh
npm install @astralbeam/sdk
```

## Usage

### Vanilla (any web app)

`@astralbeam/sdk/client` is a tiny framework-agnostic loader with no dependencies of its own; the React-based chat widget is bundled into a lazily loaded chunk, so the host page does not need React.

```ts
import { mountAstralBeamChat } from "@astralbeam/sdk/client"

const handle = mountAstralBeamChat(document.getElementById("sidebar"))
// later: handle.unmount()
```

The widget renders inside a shadow root on the mount target, so its styles never leak into (or absorb from) the host page. Any children already inside the mount target are projected into the widget's `<slot>`, which is how host apps place their own UI inside the widget.

### React

`@astralbeam/sdk/react` wraps the vanilla client in an `<AstralBeamChat>` component. It requires the `react` peer dependency (already present in any React app):

```sh
npm install @astralbeam/sdk react react-dom
```

Render `<AstralBeamChat>` wherever the chat sidebar should appear; it fills its container's height, mounts the widget on mount, and unmounts it on cleanup. Anything passed as `children` is projected into the widget's `<slot>`, so you can place your own components inside the widget — they stay part of your React tree, so state, context, and event handlers keep working:

```tsx
import { AstralBeamChat } from "@astralbeam/sdk/react"

export function Sidebar() {
  return (
    <AstralBeamChat>
      <MyCustomPanel />
    </AstralBeamChat>
  )
}
```

The widget itself loads as a separate lazy chunk with its own bundled React copy and renders in a shadow root, so it neither depends on nor conflicts with your app's React version or styles. Only the thin `<AstralBeamChat>` wrapper runs on your app's React.

## Entry points

- `@astralbeam/sdk/client` — framework-agnostic browser client
- `@astralbeam/sdk/server` — server-side helpers (placeholder)
- `@astralbeam/sdk/react` — React components (e.g. `<AstralBeamChat />`), requires the `react` peer dependency
- `@astralbeam/sdk/vue` — Vue components, requires the `vue` peer dependency (placeholder)

## License

[MIT](./LICENSE)
