# Getting started

The AstralBeam sidebar connects your app to an agent. Let’s install the package, mount the widget, and add the token endpoint. The widget streams from an AstralBeam chat endpoint and renders inside a shadow root that isolates its styles from yours.

First, install the SDK in your application:

```sh
npm install @astralbeam/sdk
```

**TIP**: Without npm or a bundler, as in Rails, Django, Laravel, or PHP apps, load the widget from jsDelivr with a [script tag](./script-tag.md).

## Mount in React

`<AstralBeamChat>` is the whole integration. Every option is a prop.

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

- The package has no runtime dependencies. `react` and `react-dom` are optional peers, and other entry points never load them.
- All options update in place, including `agentId`, `apiUrl`, and `fetchAstralBeamToken`, preserving the session and transcript.

## Mount anywhere else

`mountAstralBeamChat` takes a target element and options, and returns a handle.

```ts
import { mountAstralBeamChat } from "@astralbeam/sdk/client"

const handle = mountAstralBeamChat(document.getElementById("sidebar"), { title: "Acme Assistant" })
handle.update({ colorScheme: "dark" })
handle.unmount()
```

- `@astralbeam/sdk/client` carries no React. The chat loads lazily with its own bundled copy.
- `update` merges option changes in place, keeping the transcript and live widget renders.

## Layout

The widget fills its container, so the container must have a real height.

- In a flex column, give the container `flex-1` and `min-h-0`. Without `min-h-0` it collapses.
- Mount above your router if the transcript should survive page navigation.
- The widget does not know about notches. Keep safe-area padding on your container.

## Next

- [Authentication](./authentication.md), required before the widget will chat.
- [Script tag](./script-tag.md), load from jsDelivr and wire into Ruby on Rails.
- [Configuration](./configuration.md), every option.
- [Tools and widgets](./tools-and-widgets.md), let the agent act on and draw in your app.
- [Headless](./headless.md), own the whole chat UI on the same session.
- [Security model](./security.md), who grants, who enforces, what the client can change.

## A complete TanStack Start example

[Linearity](https://github.com/AstralBeamAI/astralbeam/tree/main/examples/linearity-react) puts the pieces together in a project tracker: a shadcn/ui host, a server token route, browser-persisted issues, and an assistant that changes them. Let’s use it as a reference when adding the SDK to a larger app.

1. Keep the API key in a server environment variable. In Vite-based apps, a `VITE_` prefix exposes a value to the browser. Only the API base and public agent ID use that prefix.
2. Put token minting in a TanStack Start server route. The [example handler](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/linearity-react/src/routes/api/astralbeam/token.ts) returns `{ token }` with `Cache-Control: no-store`.
3. Give the sidebar a definite height and keep browser storage reads out of server rendering. Linearity subscribes to its browser store after hydration.
4. Set the agent’s system prompt in the dashboard. The widget’s `title` and welcome copy change its appearance, not the agent’s instructions.

**NOTE**: Linearity’s shared password and selectable identities are for a mock playground. Your customer app must derive its Tenant and tenant user from an authenticated session.
