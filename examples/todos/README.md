# Todos example

A standalone TanStack Start app with a browser-persisted todo list, search, completion toggles, deletion and light/dark themes. It has no assistant, API credentials or backend service dependency.

From the repository root, install the workspace with `bun install --frozen-lockfile`, then run `bun run --cwd examples/todos dev`. Open <http://localhost:4700>.

The native list uses `TodoCard` and the validated operations in `useTodos`, ready to reuse in chat.

Use the [Todos tutorial](../../platform/src/routes/docs/-content/start/todos-tutorial.md) to add an assistant to this app.
