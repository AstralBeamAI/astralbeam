# Todos tutorial

Let's add an assistant to a todo app, connect its tools to the list, and show live todo cards in chat. Each step shows the relevant code and links to the complete file on `main`.

## 1. Run the starter

The [starter branch](https://github.com/AstralBeamAI/astralbeam/tree/examples/todos-starter/examples/todos) already has browser persistence, create/update/delete helpers, and a `TodoCard` used by the list. It has no SDK integration. Create a working branch from it in a clean checkout:

```sh
git fetch origin
git switch -c todos-tutorial origin/examples/todos-starter
```

Complete [contributor setup](https://github.com/AstralBeamAI/astralbeam/blob/main/SETUP.md) to install dependencies, seed development data, and build the SDK. Then run Platform and Todos in separate terminals:

```sh
bun run --cwd platform dev
```

```sh
bun run --cwd examples/todos dev
```

Open [localhost:4700](http://localhost:4700). Add a todo, toggle it, and reload to check persistence.

## 2. Connect authentication

Install the built workspace SDK from the repository root:

```sh
bun add --cwd examples/todos '@astralbeam/sdk@workspace:*'
```

Setup writes `examples/todos/.env` if absent. Check its Todos API key, agent ID, and API URL. The key and agent must belong to the same organization. Keep the key server-side.

Copy the demo [token route](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/src/routes/api/astralbeam/token.ts), [server config](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/src/lib/config.server.ts), and [demo identity](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/src/lib/constants.server.ts). The route's core is:

```ts title="src/routes/api/astralbeam/token.ts"
const token = await createAstralBeamToken({
  apiKey: API_KEY,
  user: DEMO_CHAT_USER,
  tenant: DEMO_CHAT_TENANT,
})
return tokenResponse({ token }, 200)
```

The SDK calls `/api/astralbeam/token` by default. Restart Todos after changing environment values.

**NOTE**: The demo grants one fixed identity and is disabled in production. In your app, derive user and tenant IDs from an authenticated session. See [Authentication](/docs/sdk/authentication).

## 3. Register host tools

Create [`TodosAssistant`](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/src/components/todos-assistant.tsx). Its tools call the starter's [`useTodos` helpers](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/src/hooks/use-todos.ts), just like the native list. For example, `create_todo` needs only its input schema and the existing mutation:

```tsx title="src/components/todos-assistant.tsx"
const { createTodo } = useTodos()
const tools: Record<string, ToolDefinition> = {
  create_todo: {
    metadata: { title: "Create a todo" },
    description: "Create a new todo and append it to the list.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" }, completed: { type: "boolean" } },
      required: ["text"],
    },
    execute: (input) => ({ created: createTodo(input) }),
  },
}
```

Use the same pattern for `get_todos`, `update_todo`, and `delete_todo` from the [complete tool definitions](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/src/components/todos-assistant.tsx). `getTodos()` reads current state at execution time, so consecutive calls see earlier edits. Mutations validate model input before changing the list.

## 4. Show live cards

Register `todoCard` in the assistant's `widgets` prop with an `id` number parameter. Reuse the starter's [`TodoCard`](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/src/components/todo-card.tsx) and look up that ID in reactive `todos`:

```tsx title="src/components/todos-assistant.tsx"
render: ({ id }) => {
  const todo = todos.find((entry) => entry.id === Number(id))
  return todo && <TodoCard todo={todo} onToggle={() => toggleTodo(todo.id)} />
},
```

The card and list now share state in both directions. Pass record IDs through the conversation, and authorize any backend mutations on your server. See the [complete widget registration](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/src/components/todos-assistant.tsx).

## 5. Mount the assistant

Copy the public configuration from [`config.ts`](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/src/lib/config.ts). Inside `TodosAssistant`, pass the API URL, agent ID, and registrations to the SDK:

```tsx title="src/components/todos-assistant.tsx"
<AstralBeamChat
  apiUrl={ASTRALBEAM_API_URL}
  agentId={CHAT_AGENT_ID}
  tools={tools}
  widgets={widgets}
  sandboxPanel
/>
```

Use the [complete component](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/src/components/todos-assistant.tsx) for imports, sidebar sizing, and appearance props. Add the sidebar rules from [`styles.css`](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/src/styles.css).

Import `TodosAssistant` into [`AppShell`](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/src/components/app-shell.tsx) and place it immediately after `</main>`. The shared layout keeps chat mounted during navigation:

```tsx title="src/components/app-shell.tsx"
<TodosAssistant colorScheme={colorScheme} />
```

See [SDK configuration](/docs/sdk/configuration) for appearance, resizing, and optional controls.

## 6. Try it

In Platform, configure a provider under **Models** and assign its model to the Todos agent under **Agents**. Setup does this when `OPENAI_API_KEY` is configured and the organization has no provider. The seed installs the [Todos agent prompt](https://github.com/AstralBeamAI/astralbeam/blob/main/platform/scripts/seed/fixtures.ts). Model calls may incur charges.

1. Ask **"Add a todo called Water the plants and show its card."** Check that a row and card appear.
2. Toggle the card, then toggle the row. Both should stay in sync.
3. Ask **"Delete Water the plants."** Reload and check that it stays deleted.

With **Allow attachments** enabled and Platform file storage configured, attach `samples/tasks.csv` and ask **"Add the tasks from this CSV."** Check the new rows.

Configure and test a provider under **Sandboxes**, then select it on the Todos agent. Ask **"Export my todos as CSV using the sandbox."** Check the command exit codes and download the result from **Sandbox**. Published files remain in saved history after the workspace stops.

## Continue

The [completed example](https://github.com/AstralBeamAI/astralbeam/tree/main/examples/todos) also includes Users, Conversations, and theme/debug controls. Follow [Tenant directories](/docs/sdk/listings) to add them, or use the [browser-suite guide](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/e2e/README.md) for automated checks. Its agent tests spend provider credits.

Read the [security model](/docs/sdk/security) before connecting tools to production data.
