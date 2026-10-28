# Tools and widgets

Tools let an agent call your application code. Widgets render your components in its replies. Follow the [Todos tutorial](/docs/start/todos-tutorial) for a working integration with shared state, a test prompt, and two-way updates.

## Tools

Register an action in the chat's `tools` prop. This fragment assumes your application provides `restartService`:

```ts
tools: {
  restart_service: {
    metadata: { title: "Restart a service" },
    description: "Restart one of the host app's services by name",
    parameters: { type: "object", properties: { service: { type: "string" } }, required: ["service"] },
    execute: async ({ service }) => await restartService(String(service)),
  },
}
```

- The resolved value is returned to the agent as the tool result. A thrown error leaves the action's outcome unknown, because it may already have changed external state.
- Return JSON-compatible values. Omit absent object fields instead of setting them to `undefined`, and convert dates or custom objects to plain values.
- The SDK names the tool when its result cannot be sent. Its action may already have happened, so read current state before retrying.
- A string `metadata.title` labels the tool's transcript entry in prose instead of its registry name.
- New tools reach the agent on its next run.

## Widgets

Register a component in `widgets`. Your application provides `StatusCard`:

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
- Reopening saved history restores widget props without rerunning business tools. Persist the host records those props reference, and render a fallback when a record was deleted.

## Schemas

`parameters` accepts object JSON Schema or a [Standard Schema](https://standardschema.dev) validator with JSON Schema export. `outputSchema` can describe any JSON value.

- A Standard Schema is enforced in the browser before your `execute` or `render` runs. JSON Schema export errors are surfaced during declaration.
- Plain JSON Schema also validates input in the browser. Standard Schema validators must provide JSON Schema export.
- Models sometimes send numbers as strings. With Zod, prefer `z.coerce.number()` over `z.number()`.
- The model is held to a schema only when every object in it lists its `properties` and allows no other keys. A free-form object such as `z.record()` still works, but the model may then send input that does not match.

## Typed definitions

`defineTool` and `defineWidget` infer callback inputs from a Standard Schema. They return the definition unchanged.

```tsx
import { defineTool, defineWidget } from "@astralbeam/sdk/react"
import { z } from "zod"

const todoCard = defineWidget({
  description: "A single todo from the host app, addressed by its id",
  parameters: z.object({ id: z.coerce.number() }),
  render: ({ id }) => <TodoCard id={id} />,
})

const createTodo = defineTool({
  description: "Create a new todo and append it to the list",
  parameters: z.object({ text: z.string().min(1) }),
  execute: ({ text }) => addTodo(text), // text: string, validated before this runs
})
```

- Import them from `@astralbeam/sdk/react` (JSX widgets) or `@astralbeam/sdk/client` (container widgets). `@astralbeam/sdk/core` has `defineTool` only, because its widgets carry no `render`.
- With a plain JSON Schema, the input stays `Record<string, unknown>`, which is the honest type.

## Results and widget context

Return JSON data directly, including arrays and primitives. The SDK constructs the model-safe envelope. For custom results, let's use `toolResult(...)`:

```ts
import { toolResult } from "@astralbeam/sdk/core"

return toolResult({
  content: "Found three todos",
  structuredContent: { count: 3 },
  uiData: { todos },
})
```

- Only `toolResult(...)` marks an envelope. Business data can use the same field names. `content` accepts text or content blocks, or defaults to JSON from `structuredContent`.
- `uiData` is retained for widgets and saved history, and excluded from model context and raw disclosures. Set `isError: true` for a known failure.
- `execute(input, context)` receives `signal` and an optional `invocationId`. Callbacks may omit unused arguments. Cancellation cannot undo completed changes.
- Set a tool's `widget` to its presentation ID. Standalone widgets declare schema-specific `show_<id>` tools. Existing saved `render_widget` calls remain readable.
- React uses `render(props, context)`. Native rendering uses `render(props, container, context)` and returns cleanup or `{ update(context), dispose() }`.
- Context includes `input`, `result`, `status`, `invocationId`, `signal`, and `callTool(name, input)`. Local calls validate and run app-visible tools without a chat message.
- `visibility` defaults to `["model", "app"]`. Add `tools` to a `defineWidget` definition for inferred local-call names, inputs, and results. `annotations` carry advisory behavior hints.
- Input and output validation support Effect's [Draft 2020-12 subset](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/SchemaRepresentation.ts). Unsupported contracts fail declaration. Server validation uses bounded regex analysis.

## Live state

Tools can run many turns after registration. Read current state when they execute.

- All session adapters resolve the current `execute` callback after validation. Removing a tool or replacing its `parameters` schema blocks pending execution. Keep schema objects stable when updating only callbacks.
- Widget renders re-read the current `widgets` prop, so host state changes re-render projected UI.
- Pass ids in widget props and resolve them against your own state, rather than snapshotting data into props.

## Read after a write

An agent can call several tools before React renders again. Commit each change before returning its result so the next tool reads it.

- For server data, await the mutation and read from the authoritative response or refreshed cache.
- For browser data, commit to a synchronous store before returning. React can subscribe to that store with `useSyncExternalStore`.
- Resolve issue, project, and assignee IDs inside the active Tenant. A valid schema does not establish ownership.
- Keep manual edits and agent edits on the same mutation path so both validate, persist, and notify the UI in the same way.

[Linearity’s store](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/linearity-react/src/lib/store.ts) demonstrates this with localStorage. Its issue widgets receive only an ID and resolve the latest issue on each render.

## Navigating the host app

Navigation is another host tool. Let’s give the agent URLs from your app’s own issue and project records, validate its destination, and pass the URL to your client router. Keep the sidebar in a persistent layout so opening an issue does not discard the conversation.

[Linearity’s navigation tool](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/linearity-react/src/lib/astro-tools.ts) accepts only known views and records in the active workspace. It rejects external URLs and another workspace’s IDs. Your production app must also enforce the current user’s permissions, just as it does for manual navigation.
