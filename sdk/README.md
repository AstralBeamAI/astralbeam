# @astralbeam/sdk

A drop-in agent chat sidebar for your web app, from [AstralBeam](https://astralbeam.ai).

The widget renders in a shadow root, so its styles never mix with yours. It streams from an AstralBeam webapp's `/api/chat`.

```sh
npm install @astralbeam/sdk
```

## Quick start

### React

```tsx
import { AstralBeamChat } from "@astralbeam/sdk/react"

export function Sidebar() {
  return <AstralBeamChat chatEndpoint="https://myapp.example/api/chat" />
}
```

`react` and `react-dom` are optional peer dependencies. The component fills its container's height.

### Any other framework

```ts
import { mountAstralBeamChat } from "@astralbeam/sdk/client"

const handle = mountAstralBeamChat(document.getElementById("sidebar"), {
  chatEndpoint: "https://myapp.example/api/chat",
})
// handle.update({ colorScheme: "dark" }) — handle.unmount()
```

`@astralbeam/sdk/client` carries no React. The widget loads as a lazy chunk with its own bundled copy.

## Authentication

The widget will not chat until it has a token, and it never sees your API key.

Add one endpoint to your app — `/api/astralbeam/token` by default. It authenticates your own session, then mints a short-lived token from trusted server-side state.

```ts
import { createAstralBeamChatToken } from "@astralbeam/sdk/server"

export async function POST(request: Request) {
  const session = await requireApplicationSession(request)
  const token = await createAstralBeamChatToken({
    apiKey: process.env.ASTRALBEAM_API_KEY!, // key_<organization>_<key>_abo_<secret>
    tenantUser: {
      id: session.user.id, // required; stable and unique per organization
      name: session.user.name,
      email: session.user.email,
      tenant: { id: session.tenant.id, name: session.tenant.name },
    },
  })
  return Response.json({ token }, { headers: { "cache-control": "no-store" } })
}
```

- Never derive `tenantUser` from anything the browser sent.
- Never put a secret in it: tokens are signed, not encrypted.
- Lifetimes are 60–600 seconds, five minutes by default.
- The SDK keeps the token in memory and renews it before it expires.

## Options

Every option below is also a prop on `<AstralBeamChat>`.

`handle.update(options)` applies any subset in place, keeping the transcript, the session, and live widget renders.

`agentId`, `chatEndpoint`, and `authEndpoint` are fixed at mount, because they select the agent and build the transport.

| Option                           | Default                   | Meaning                                                                                                        |
| -------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `agentId`                        | organization's default    | `agt_<organization>_<agent>` from the dashboard                                                                |
| `chatEndpoint`                   | `/api/chat`               | The AstralBeam webapp's chat endpoint                                                                          |
| `authEndpoint`                   | `/api/astralbeam/token`   | Your token endpoint                                                                                            |
| `systemPrompt`                   | the agent's stored prompt | Overrides the agent's instructions for this integration                                                        |
| `title`, `showHeader`            | `"AstralBeam"`, `true`    | Header text, and whether the header and its reset button show                                                  |
| `emptyTitle`, `emptyDescription` | generic copy              | Headline and subtitle of the empty transcript                                                                  |
| `colorScheme`                    | `"system"`                | `"light"`, `"dark"`, or `"system"`, which follows the OS setting live                                          |
| `theme`                          | the widget's own palette  | `{ light, dark }` maps of [shadcn/ui tokens](https://ui.shadcn.com/docs/theming); `light` is the base for both |
| `attachments`                    | `true`                    | `false` hides the feature, or pass an options object                                                           |
| `tools`, `widgets`               | none                      | What the agent can do and draw in your app                                                                     |
| `debug`                          | `false`                   | Log every SDK action to the browser console, and the run to the server console                                 |

Assistant replies render as Markdown. Raw HTML is escaped and executable link protocols are dropped.

## Tools and widgets

Both are keyed by name, and declared to the agent with a `description` and a `parameters` schema.

A schema is a plain JSON Schema object, or any [Standard Schema](https://standardschema.dev) validator — Zod, Valibot, ArkType.

A Standard Schema is also enforced in the browser before your code runs. With a plain JSON Schema, treat the agent's input as untrusted.

A **tool** does something. Its `execute` runs in your page, and the value it resolves streams back to the agent.

```ts
tools: {
  restart_service: {
    metadata: { title: "Restart a service" }, // transcript label; defaults to the tool's name
    description: "Restart one of the host app's services by name",
    parameters: { type: "object", properties: { service: { type: "string" } }, required: ["service"] },
    execute: async ({ service }) => await restartService(String(service)),
  },
}
```

A **widget** shows something. Its `render` draws your own UI into the conversation.

```tsx
widgets: {
  systemStatus: {
    description: "Shows the current status of the host app's systems",
    parameters: { type: "object", properties: { degraded: { type: "boolean" } } },
    render: ({ degraded }) => <StatusCard degraded={Boolean(degraded)} />,
  },
}
```

- In React, `render` returns JSX; elsewhere it draws into a container and may return a cleanup.
- Renders live in your app's tree, so state, context, and event handlers keep working.
- They inherit the host page's typography and CSS custom properties automatically.
- Your own selectors match a render like any other element.
- Properties are read from the mount target's _parent_, so rules on the target itself are missed.
- Tokens declared only in a cross-origin stylesheet cannot be read.
- New tools and widgets reach the agent on its next run.
- Dropping a widget disposes any render of it still in the transcript.

## Attachments

The composer takes files by default: paperclip button, drag and drop, or paste.

Images and PDFs go to the model as-is. Text files, including source files, are read as text by the endpoint.

A file that cannot be sent keeps its chip and says why. Files ride inline and stay in context for the run.

| `attachments` option | Default                                    | Meaning                                             |
| -------------------- | ------------------------------------------ | --------------------------------------------------- |
| `enabled`            | `true`                                     | `false` is the same as `attachments: false`         |
| `maxFiles`           | `5`                                        | Files per message                                   |
| `maxFileBytes`       | per kind: 5 MB image, 10 MB PDF, 1 MB text | One file; the smaller of this and the kind cap wins |
| `maxTotalBytes`      | 20 MB                                      | All files on one message                            |
| `accept`             | everything supported                       | MIME types or `type/*` patterns, e.g. `["image/*"]` |

The endpoint enforces the same limits independently, so narrowing them here is an affordance, not a boundary.

## Sandbox

An agent with a sandbox provider configured in the dashboard can write files and run commands.

It gets one isolated Linux sandbox per conversation, so it can build on what it already wrote.

- Nothing to wire up: the agent's provider and instructions are owned by the organization.
- Each step is a transcript row that expands to the file written, or the command's output.
- A **Sandbox** tray above the composer collects every file and the whole command log.

## Entry points

| Entry point              | Contents                                  | Peer dependency      |
| ------------------------ | ----------------------------------------- | -------------------- |
| `@astralbeam/sdk/client` | `mountAstralBeamChat`, the vanilla loader | none                 |
| `@astralbeam/sdk/react`  | `<AstralBeamChat>`                        | `react`, `react-dom` |
| `@astralbeam/sdk/server` | `createAstralBeamChatToken`               | none                 |
| `@astralbeam/sdk/vue`    | Vue components (placeholder)              | `vue`                |

There is no root export. Conversation history is not built yet.

## Example

[`examples/todos`](../examples/todos) embeds the sidebar in a minimal TanStack Start app.

It has a demo token route, host tools over live React state, and a `todoCard` widget the agent renders per todo.

It uses no Tailwind or shadcn/ui of its own, to show the shadow-root boundary.

## License

[MIT](./LICENSE)
