# Todos tutorial

Build an assistant that adds, updates, and deletes todos, with live cards in chat. You'll connect tools to the same state and components the app already uses. The code excerpts link to complete files on `main`.

## 1. Run the starter

You'll need Git, Bun, and a model-provider API key. The [starter branch](https://github.com/AstralBeamAI/astralbeam/tree/examples/todos-starter/examples/todos) includes a working todo list with browser persistence and a `TodoCard` component. Create a working branch from it in a clean checkout:

```sh
git fetch origin
git switch -c todos-tutorial origin/examples/todos-starter
```

Complete [contributor setup](https://github.com/AstralBeamAI/astralbeam/blob/main/docs/SETUP.md) to install dependencies, seed development data, and build the SDK. Then run Platform and Todos in separate terminals:

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

Use the [complete component](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/src/components/todos-assistant.tsx) for imports and sidebar sizing. Add the sidebar rules from [`styles.css`](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/src/styles.css).

Import `TodosAssistant` into [`AppShell`](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/src/components/app-shell.tsx) and place it immediately after `</main>`. The shared layout keeps chat mounted during navigation:

```tsx title="src/components/app-shell.tsx"
<TodosAssistant colorScheme={colorScheme} />
```

## 6. Try it

In Platform, configure a provider under **Models** and assign its model to the Todos agent under **Agents**. Setup does this when `OPENAI_API_KEY` is configured and the organization has no provider. The seed installs the [Todos agent prompt](https://github.com/AstralBeamAI/astralbeam/blob/main/platform/scripts/seed/fixtures.ts). Model calls may incur charges.

1. Ask **"Add a todo called Water the plants and show its card."** Check that a row and card appear.
2. Toggle the card, then toggle the row. Both should stay in sync.
3. Ask **"Delete Water the plants."** Reload and check that it stays deleted.

You now have tools and widgets connected to the same todo list.

## Try files and code execution

To extend the example, enable **Allow file attachments** on the agent, configure Platform file storage, and select a tested [sandbox provider](/docs/dashboard/sandboxes). Attach `samples/tasks.csv` and ask **"Add the tasks from this CSV."** Check the new rows.

Ask **"Export my todos as CSV using the sandbox."** Check the command exit codes and download the result from **Sandbox**. Published files remain in saved history after the workspace stops.

## Continue

Compare your app with the [completed example](https://github.com/AstralBeamAI/astralbeam/tree/main/examples/todos). To add a customer user list, follow [Tenant directories](/docs/sdk/listings). For automated checks, use the [example's browser suite](https://github.com/AstralBeamAI/astralbeam/blob/main/examples/todos/e2e/README.md), whose agent tests spend provider credits.

Read the [security model](/docs/sdk/security) before connecting tools to production data.
