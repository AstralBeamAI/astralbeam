# Tools and widgets

Tools let an agent act in your app, and widgets show your UI in its replies. Let’s connect both to the state your users already work with.

## Tools

Let’s declare tools in a keyed object. Implementations can omit unused callback arguments.

```ts
tools: {
  restart_service: {
    metadata: { title: "Restart a service" }, // transcript label; defaults to the tool's name
    description: "Restart one of the host app's services by name",
    parameters: { type: "object", properties: { service: { type: "string" } }, required: ["service"] },
    execute: async ({ service }, { signal }) => await restartService(String(service), { signal }),
  },
}
```

- Return JSON data directly, including arrays, primitives, and domain objects. The SDK supplies `structuredContent` and a JSON text fallback.
- `execute(input, context)` receives validated input, `signal`, and an optional `invocationId`. Cancellation cannot undo an action already applied.
- `outputSchema` validates successful structured output locally and against the saved server declaration. Return plain JSON without `undefined` fields.
- `metadata.title` labels the transcript. `annotations` provide advisory hints. `visibility` defaults to `["model", "app"]`, or use `["app"]` for widget-only actions.
- A thrown error leaves the action's outcome unknown. Its changes may already be applied, so read current state before retrying.

For custom results, let’s use `toolResult(...)`. Ordinary data can use the same field names without being mistaken for an envelope.

```ts
import { toolResult } from "@astralbeam/sdk/core"

return toolResult({
  content: "Found three todos",
  structuredContent: { count: 3 },
  uiData: { todos },
})
```

`content` accepts text or content blocks. Omit it for a JSON fallback from `structuredContent`, or no content for UI-only results. `uiData` stays out of model history and raw disclosures. Set `isError: true` for a known failure.

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

- Standalone widgets expose `show_<id>` tools with their actual input schema. Tool names use letters, digits, dots, underscores, or hyphens, up to 128 characters.
- Set a tool's `widget` to its presentation ID. Supply a compatible widget input schema, or omit it for result-only presentations.
- React uses `render(props, context)`. Native rendering uses `render(props, container, context)` and returns cleanup or `{ update(context), dispose() }`.
- Context provides `input`, `result`, `status`, `invocationId`, `signal`, and `callTool(name, input)`. Status is pending, complete, error, or cancelled.
- `callTool` validates and runs an app-visible tool without another assistant response, returning its data or custom result. Presentation failures never retry business actions.
- Renders stay in your app's tree with working state and context. Several can coexist. The oldest collapse after the render cap.
- Removing a widget disposes its presentations. Reopening history restores input and results without executing business tools. Show a fallback for deleted host records.
- Existing saved plain results and `render_widget` calls remain readable. New results carry an explicit format version internally.

## Schemas

`parameters` accepts object JSON Schema. `outputSchema` can describe any JSON value. Both also accept a [Standard Schema](https://standardschema.dev) validator with [Standard JSON Schema export](https://standardschema.dev/json-schema), such as Zod 4.

- Both formats validate input before execution or rendering. Missing JSON Schema export fails declaration.
- Models sometimes send numbers as strings. With Zod, prefer `z.coerce.number()` over `z.number()`.
- Validation supports Effect's [Draft 2020-12 subset](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/SchemaRepresentation.ts). Unsupported contracts fail registration. Server admission bounds regex analysis for untrusted declarations.

## Typed definitions

The optional `defineTool` and `defineWidget` helpers preserve the supplied object and callback arguments: with a Standard Schema in `parameters`, the `execute` or `render` input is the schema's own output type.

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
- Inline definitions need no helpers. Separate registries can use `satisfies ToolRegistry` or `satisfies WidgetRegistry`. Plain JSON Schema input stays `Record<string, unknown>`.
- Add `tools` to a widget definition to infer `callTool` names, schema inputs, and results. Omit `parameters` when a tool takes no input.

## Live state

Definitions are declared once but called many turns later, so make sure they read current state.

- The drop-in React component routes `execute` through the latest `tools` prop, keeping closures fresh. Headless and vanilla sessions capture callbacks for the active run, so replacements or removals take effect on the next run.
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
