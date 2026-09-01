# Tools and widgets

A tool does something: its `execute` runs in your page and the resolved value streams back to the agent. A widget shows something: its `render` draws your own UI inline in the conversation. Both are keyed by name and declared to the agent with a `description` and a `parameters` schema.

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

- The resolved value is returned to the agent as the tool result; a thrown error becomes a tool error.
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

- In React, `render` returns JSX; elsewhere it draws into a container and may return a cleanup.
- Renders live in your app's tree, so state, context, and event handlers keep working.
- Several renders of one widget can be live at once; the oldest collapse to a summary past a cap.
- Dropping a widget disposes any render of it still in the transcript.

## Schemas

`parameters` is a plain JSON Schema object, or any [Standard Schema](https://standardschema.dev) validator such as Zod, Valibot, or ArkType.

- A Standard Schema is enforced in the browser before your `execute` or `render` runs.
- With plain JSON Schema, nothing validates in the browser: treat the agent's input as untrusted.
- Models sometimes send numbers as strings; with Zod, prefer `z.coerce.number()` over `z.number()`.

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

- Import them from `@astralbeam/sdk/react` (JSX widgets) or `@astralbeam/sdk/client` (container widgets).
- With a plain JSON Schema, the input stays `Record<string, unknown>`, which is the honest type.

## Live state

Definitions are declared once but called many turns later, so make sure they read current state.

- In React, the SDK routes `execute` through the latest `tools` prop, so rebuilding the object each render is fine and keeps closures fresh.
- Widget renders re-read the current `widgets` prop, so host state changes re-render projected UI.
- Pass ids in widget props and resolve them against your own state, rather than snapshotting data into props.
