# Tools and widgets

Tools let an agent act in your app, and widgets show your UI in its replies. Let’s connect both to the state your users already work with.

## Tools

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

- The resolved value is returned to the agent as the tool result. A thrown error becomes a tool error.
- Return JSON-compatible values. Omit absent object fields instead of setting them to `undefined`, and convert dates or custom objects to plain values.
- The SDK names the tool when its result cannot be sent. Its action may already have happened, so read current state before retrying.
- A string `metadata.title` labels the tool's transcript entry in prose instead of its registry name.
- New tools reach the agent on its next run.

## Widgets

```tsx
widgets: {
  systemStatus: {
    description: "Shows the current status of the host app's systems",
    parameters: { type: "object", properties: { degraded: { type: "boolean" } } },
    render: ({ degraded }) => <StatusCard degraded={Boolean(degraded)} />,
  },
}
```

- In React, `render` returns JSX. Elsewhere it draws into a container and may return a cleanup.
- Renders live in your app's tree, so state, context, and event handlers keep working. An inline picker can call the same mutation function as a form elsewhere in your app.
- Clicking a widget does not send a chat message or return a tool result. Have the agent read current state before its next change so it sees edits made through your UI.
- Several renders of one widget can be live at once. The oldest collapse to a summary past a cap.
- Dropping a widget disposes any render of it still in the transcript.

## Schemas

`parameters` is a plain JSON Schema object, or any [Standard Schema](https://standardschema.dev) validator such as Zod, Valibot, or ArkType.

- A Standard Schema is enforced in the browser before your `execute` or `render` runs.
- With plain JSON Schema, nothing validates in the browser: treat the agent's input as untrusted.
- Models sometimes send numbers as strings. With Zod, prefer `z.coerce.number()` over `z.number()`.

## Typed definitions

`defineTool` and `defineWidget` are identity helpers that exist for their generics: with a Standard Schema in `parameters`, the `execute` or `render` input is the schema's own output type.

```tsx
import { defineTool, defineWidget } from "@astralbeam/sdk/react"
import { z } from "zod"

const todoCard = defineWidget({
  description: "A single todo from the host app, addressed by its id",
  parameters: z.object({ id: z.coerce.number(), highlight: z.boolean().optional() }),
  render: ({ id, highlight }) => <TodoCard id={id} highlight={highlight ?? false} />,
})

const createTodo = defineTool({
  description: "Create a new todo and append it to the list",
  parameters: z.object({ text: z.string().min(1) }),
  execute: ({ text }) => addTodo(text), // text: string, validated before this runs
})
```

- Import them from `@astralbeam/sdk/react` (JSX widgets) or `@astralbeam/sdk/client` (container widgets). `@astralbeam/sdk/core` has `defineTool` only, because its widgets carry no `render`.
- With a plain JSON Schema, the input stays `Record<string, unknown>`, which is the honest type.

## Live state

Definitions are declared once but called many turns later, so make sure they read current state.

- In React, the SDK routes `execute` through the latest `tools` prop, so rebuilding the object each render is fine and keeps closures fresh.
- Widget renders re-read the current `widgets` prop, so host state changes re-render projected UI.
- Pass ids in widget props and resolve them against your own state, rather than snapshotting data into props.

## Read after a write

An agent can call several tools before React renders again. Because state setters schedule a render, a second tool can read stale data if the first tool only called `setState`. Let’s keep the tool result and the next read in agreement.

- For server data, await the mutation and read from the authoritative response or refreshed cache.
- For browser data, commit to a synchronous store before returning. React can subscribe to that store with `useSyncExternalStore`.
- Resolve issue, project, and assignee IDs inside the active Tenant. A valid schema does not establish ownership.
- Keep manual edits and agent edits on the same mutation path so both validate, persist, and notify the UI in the same way.

[Linearity’s store](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/linearity-react/src/lib/store.ts) demonstrates this with localStorage. Its issue widgets receive only an ID and resolve the latest issue on each render.

## Navigating the host app

Navigation is another host tool. Let’s give the agent URLs from your app’s own issue and project records, validate its destination, and pass the URL to your client router. Keep the sidebar in a persistent layout so opening an issue does not discard the conversation.

[Linearity’s navigation tool](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/linearity-react/src/lib/astro-tools.ts) accepts only known views and records in the active workspace. It rejects external URLs and another workspace’s IDs. Your production app must also enforce the current user’s permissions, just as it does for manual navigation.
