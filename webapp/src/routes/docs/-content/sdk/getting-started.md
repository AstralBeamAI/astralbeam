# Getting started

Install the package, mount the widget, and add the token endpoint. The widget streams from an AstralBeam chat endpoint and renders inside a shadow root that isolates its styles from yours.

```sh
npm install @astralbeam/sdk
```

## Mount in React

`<AstralBeamChat>` is the whole integration; every option is a prop.

```tsx
import { AstralBeamChat } from "@astralbeam/sdk/react"

export function Sidebar() {
  return (
    <aside className="flex h-dvh min-h-0 flex-col">
      <AstralBeamChat title="Acme Assistant" />
    </aside>
  )
}
```

- `react` and `react-dom` are optional peer dependencies; other entry points never load them.
- Prop changes apply in place; the transcript and session survive them.
- `agentId`, `chatEndpoint`, and `authEndpoint` are fixed at mount.

## Mount anywhere else

`mountAstralBeamChat` takes a target element and options, and returns a handle.

```ts
import { mountAstralBeamChat } from "@astralbeam/sdk/client"

const handle = mountAstralBeamChat(document.getElementById("sidebar"), { title: "Acme Assistant" })
handle.update({ colorScheme: "dark" })
handle.unmount()
```

- `@astralbeam/sdk/client` carries no React; the chat loads lazily with its own bundled copy.
- `update` merges option changes in place, keeping the transcript and live widget renders.

## Layout

The widget fills its container, so the container must have a real height.

- In a flex column, give the container `flex-1` and `min-h-0`; without `min-h-0` it collapses.
- Mount above your router if the transcript should survive page navigation.
- The widget does not know about notches; keep safe-area padding on your container.

## Next

- [Authentication](./authentication.md) — required before the widget will chat.
- [Configuration](./configuration.md) — every option.
- [Tools and widgets](./tools-and-widgets.md) — let the agent act on and draw in your app.
- [Headless](./headless.md) — own the whole chat UI on the same session.
- [Security model](./security.md) — who grants, who enforces, what the client can change.
