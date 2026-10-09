# Tools and widgets

Tools let an agent act in your app, and widgets show your UI in its replies. Let’s connect both to the state your users already work with.

## Tools

Let's register tools by name in an object. Each invocation receives its own identity and cancellation signal.

```ts
import type { ToolRegistry } from "@astralbeam/sdk/core"

const tools = {
  restart_service: {
    title: "Restart a service",
    description: "Restart one of the host app's services by name",
    parameters: {
      type: "object",
      properties: { service: { type: "string" } },
      required: ["service"],
    },
    execute: async ({ service }, { signal }) => {
      const restarted = await restartService(String(service), { signal })
      return { restarted }
    },
  },
} satisfies ToolRegistry
```

- The object key is the unique, stable tool name. `title` labels the transcript. `annotations` carry advisory behavior hints, such as `readOnlyHint` and `destructiveHint`.
- `visibility` defaults to `["model", "app"]`. An app-only tool can be called from widgets without being declared to the model.
- `execute(input, context)` receives validated input and a required `context.signal`. `context.invocationId` is optional. Implementations may omit unused callback parameters. Cancellation cannot undo a completed mutation.
- Return model-safe object data directly, including typed domain objects. The SDK supplies `structuredContent` and a JSON text fallback.
- `outputSchema` validates successful `structuredContent`. Return `toolResult({ content: "Not found", isError: true })` for a known failure.
- Return JSON-compatible values without `undefined`. A thrown error leaves the outcome unknown because the action may already have changed external state.

For custom results, let's mark the envelope explicitly. `content` accepts text or content blocks. Omit it for a JSON fallback from `structuredContent`, or no model content when only `uiData` is supplied. Ordinary data can use these same field names without being mistaken for an envelope.

```ts
import { toolResult } from "@astralbeam/sdk/core"

return toolResult({
  content: "Found three todos",
  structuredContent: { count: 3 },
  uiData: { todos },
})
```

## Widgets

Widgets have stable IDs. Let's associate a tool with a result presentation, or register a standalone widget the model can request directly.

```tsx
import type { WidgetRegistry } from "@astralbeam/sdk/react"

const widgets = {
  systemStatus: {
    description: "Show the current status of the host app's systems",
    parameters: { type: "object", properties: { degraded: { type: "boolean" } } },
    render: ({ degraded }, { result, status }) => (
      <StatusCard
        degraded={Boolean(degraded)}
        data={result?.structuredContent}
        loading={status === "pending"}
      />
    ),
  },
} satisfies WidgetRegistry
```

- A standalone widget declares `show_<id>` with its actual input schema. Keep IDs compatible with tool names, using letters, digits, dots, underscores, or hyphens. Generated tool names must fit within 128 characters.
- Set a tool's `widget` to that ID to present its input and result. Supply a compatible widget input schema, or omit it for result-only presentations.
- React’s `render(props, context)` receives validated props first. Context includes `input`, `result`, `status`, `invocationId`, `signal`, and `callTool(name, input)`. Status is pending, complete, error, or cancelled.
- `uiData` reaches the widget and saved history but is excluded from model context. Keep anything the model needs in `content` or `structuredContent`.
- `callTool` validates and runs an app-visible tool without sending a chat message. It returns plain data or the tool's custom result.
- React renders stay in your app's tree with working state and context. Several calls can coexist. The oldest collapse after the render cap.

## Native rendering and restoration

Outside React, `render(props, container, context)` draws into the supplied light-DOM element. Return cleanup, or an update handle to preserve an existing presentation across lifecycle changes.

```ts
render: (_props, container, context) => {
  const view = mountStatusCard(container, context)
  return { update: (next) => view.update(next), dispose: () => view.unmount() }
}
```

- Removing a widget disposes its live presentations. A missing renderer does not retry the business action.
- Reopening history restores input and results without executing business tools. Persist records referenced by IDs, and show a fallback for deleted records.
- Existing saved plain results and `render_widget` calls remain readable. New declarations use an explicit result format version internally.

## Schemas and optional type inference

`parameters` and `outputSchema` accept object JSON Schema or a [Standard Schema](https://standardschema.dev) validator with [Standard JSON Schema](https://standardschema.dev/json-schema) export, such as Zod 4. Let's use optional helpers to infer callback types from the validator.

```tsx
import { defineTool, defineWidget } from "@astralbeam/sdk/react"
import { z } from "zod"

const tools = {
  create_todo: defineTool({
    description: "Create a todo",
    parameters: z.object({ text: z.string().min(1) }),
    execute: ({ text }) => ({ created: addTodo(text) }),
  }),
}
const widgets = {
  todoCard: defineWidget({
    description: "Show a todo by ID",
    parameters: z.object({ id: z.coerce.number() }),
    render: ({ id }) => <TodoCard id={id} />,
  }),
  newTodo: defineWidget({
    description: "Let the user add a todo",
    tools,
    render: (_props, { callTool }) => (
      <NewTodoForm onSubmit={(text) => callTool("create_todo", { text })} />
    ),
  }),
}
```

- Both schema formats validate input in the browser. Missing JSON Schema export fails declaration instead of widening the model's input contract.
- `defineTool` and `defineWidget` only provide type inference. They return the supplied object unchanged. Plain JSON Schema inputs remain `Record<string, unknown>`.
- Inline definitions receive callback types from the SDK props or options. Separate registries can use `satisfies ToolRegistry` or `satisfies WidgetRegistry`.
- Add `tools` to a `defineWidget` definition for typed `callTool` names, schema inputs, and inferred results. Omit `parameters` for tools without arguments.
- The SDK validates structured output locally, and the server validates it against the saved declaration before accepting a result.
- JSON Schema validation supports Effect's [Draft 2020-12 subset](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/SchemaRepresentation.ts). Unsupported input or output contracts fail registration before tools run. Server admission also rejects regex patterns whose evaluation cannot pass bounded analysis.
- Import helpers from `/react` for JSX or `/client` for containers. `/core` exports `defineTool` and `toolResult` for headless consumers.

## Live state

Definitions are declared once but called many turns later, so make sure they read current state.

- In React, the SDK routes `execute` through the latest `tools` prop, so rebuilding the object each render is fine and keeps closures fresh.
- Widget renders re-read the current `widgets` prop, so host state changes re-render projected UI.
- Pass IDs in widget input and resolve them against your own state, rather than snapshotting data into props.

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
