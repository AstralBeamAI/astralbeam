# Getting started

Mount the assistant in React or JavaScript. Start with the [Quickstart](/docs/start/quickstart) to configure an agent and connect your backend.

## Before mounting

Add an authenticated [token endpoint](./authentication.md) at `/api/astralbeam/token`, then install the SDK:

<!-- ::start:tabs variant="files" -->

```sh title="npm"
npm install @astralbeam/sdk
```

```sh title="pnpm"
pnpm add @astralbeam/sdk
```

```sh title="yarn"
yarn add @astralbeam/sdk
```

```sh title="bun"
bun add @astralbeam/sdk
```

<!-- ::end:tabs -->

For an app without a bundler, use a [script tag](./script-tag.md).

## Mount the widget

Give the container a definite height:

<!-- ::start:tabs variant="files" -->

```tsx title="React"
import { AstralBeamChat } from "@astralbeam/sdk/react"

export function Assistant() {
  return (
    <aside style={{ height: "100dvh" }}>
      <AstralBeamChat />
    </aside>
  )
}
```

```js title="JavaScript"
import { mountAstralBeamChat } from "@astralbeam/sdk/client"

const container = document.getElementById("assistant")
container.style.height = "100dvh"
const chat = mountAstralBeamChat(container, {})

// When removing the container, call chat.unmount().
```

<!-- ::end:tabs -->

Sign in to your application and send **"Say hello in one sentence."** A reply should stream into chat. For self-hosting, set `apiUrl` to your deployment's `/api` base. See [SDK props](./configuration.md#options) for customization.

## Layout

- In a flex column, use `flex: 1` and `min-height: 0` on the container so it can shrink and scroll.
- Mount above your router if the transcript should survive page navigation.
- The widget does not know about notches. Keep safe-area padding on your container.

## Next

[Add tools and widgets](./tools-and-widgets.md), customize [SDK props](./configuration.md), or build your own UI with [Headless](./headless.md). Read the [security model](./security.md) before exposing application actions.

## A complete TanStack Start example

[Linearity](https://github.com/AstralBeamAI/astralbeam/tree/main/examples/linearity-react) shows a persistent sidebar, server token route, and host tools in a project tracker.

**NOTE**: Its shared password and selectable identities are for a demo. Derive production identities from your authenticated session. Never expose an API key through a `VITE_` variable.
