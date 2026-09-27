# Getting started

The AstralBeam sidebar connects your app to an agent. Let’s install the package, mount the widget, and add the token endpoint. The widget streams from an AstralBeam chat endpoint and renders inside a shadow root that isolates its styles from yours.

## 1. Prepare your application

We need an application with a server and an authenticated user session. In the [dashboard](https://app.astralbeam.ai), create an organization, ask its owner to save an OpenAI key under **Settings**, and create an AstralBeam key under **API keys**. OpenAI bills model usage to your account on both hosted and self-hosted AstralBeam.

Because the widget needs a short-lived token, add `POST /api/astralbeam/token` to your application before mounting it. Follow the [quickstart](/docs/start/quickstart) for the handler and its session checks. The AstralBeam key stays on your server, and your backend derives Tenant and tenant-user identity from its trusted session.

## 2. Install the package

Let's install the SDK in your application:

```sh
npm install @astralbeam/sdk
```

**TIP**: Without npm or a bundler, as in Rails, Django, Laravel, or PHP apps, load the widget from jsDelivr with a [script tag](./script-tag.md).

## 3. Mount in React

With the token endpoint in place, let's mount `<AstralBeamChat>` in a container with a definite height. Every option is a prop, and the example requires no host CSS framework.

```tsx
import { AstralBeamChat } from "@astralbeam/sdk/react"

export function Sidebar() {
  return (
    <aside style={{ height: "100dvh" }}>
      <AstralBeamChat title="Acme Assistant" />
    </aside>
  )
}
```

- The package has no runtime dependencies. `react` and `react-dom` are optional peers, and other entry points never load them.
- All options update in place, including `agentId`, `apiUrl`, and `fetchAstralBeamToken`, preserving the session and transcript.

## Or mount anywhere else

`mountAstralBeamChat` takes a target element and options, and returns a handle. Let's first give it an element with a definite height:

```html
<div id="sidebar" style="height: 100dvh"></div>
```

Once that element exists in the browser, let's mount the widget:

```ts
import { mountAstralBeamChat } from "@astralbeam/sdk/client"

const target = document.getElementById("sidebar")
if (!target) throw new Error("Missing sidebar container")
const handle = mountAstralBeamChat(target, { title: "Acme Assistant" })
handle.update({ colorScheme: "dark" })
```

- `@astralbeam/sdk/client` carries no React. The chat loads lazily with its own bundled copy.
- `update` merges option changes in place, keeping the transcript and live widget renders.
- Call `handle.unmount()` when removing the host element or signing out. Calling it immediately after mounting removes the chat.

## 4. Verify the connection

Sign in to your application and send a message. The widget first calls your token route, then synchronizes the current user with `POST /api/v1/me` on AstralBeam, then streams the conversation through `/api/v1/chat`.

The API base defaults to `https://app.astralbeam.ai/api`. For self-hosting, pass `apiUrl` with your deployment's `/api` base and use an AstralBeam key from that deployment. To change your application's token path, pass `fetchAstralBeamToken={{ url: "/your/token/route" }}`.

Once you see a reply, let's [give the assistant its first app action](/docs/start/quickstart#8-make-the-assistant-change-your-app). If a request fails, use the [quickstart troubleshooting table](/docs/start/quickstart#troubleshooting) to identify which connection needs attention.

## Layout

The widget fills its container, so the container must have a real height.

- In a flex column with a definite height, give the container `flex: 1` and `min-height: 0` so it can fill and shrink within that space.
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
