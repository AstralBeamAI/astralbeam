# Todos tutorial

The todos example is a small application whose agent edits the list the user is looking at. It is the shortest way to see the four integration points that matter: host tools, inline widgets, attachments, and a sandbox.

Read it as a tutorial for your own integration. The code lives in `examples/todos` in the repository.

## What the example demonstrates

- The agent reads and writes the host application's state through tools that run in the page, not through an API you expose to it.
- The agent renders your own components inside the transcript, and those renders stay live as host state changes.
- A user can paste an image or attach a file and the agent can use it for that request only.
- With a sandbox provider attached to the agent, the agent can run commands and publish files the user can download.

## Run it

The quick path seeds everything. From the repository root:

```sh
deno task --cwd webapp db-seed
```

That creates an organization with a todos agent, a sandbox provider, and an API key, and writes `examples/todos/.env` when that file does not already exist.

Then start the webapp on port 4500 with `deno task dev` from `webapp`, build the SDK with `deno task build` from `sdk`, and run `deno install` followed by `deno task dev` from `examples/todos`. Open `http://localhost:4700`.

To set it up by hand instead, create an agent with the demo prompt, optionally configure a sandbox provider and select it on the agent, create an API key, and copy `.env.example` to `.env`. The example reads three variables.

| Variable                   | Purpose                                                           |
| -------------------------- | ----------------------------------------------------------------- |
| `ASTRALBEAM_API_KEY`       | Server only. The key the token route signs with.                  |
| `VITE_ASTRALBEAM_AGENT_ID` | Optional. Leave it empty to use the organization's default agent. |
| `VITE_ASTRALBEAM_API_URL`  | Optional. Defaults to the local webapp's `/api` base.             |

The API key and the agent must belong to the same organization, or the request resolves nothing.

## The token route

The example ships a token route that mints for one fixed demo identity and refuses to run in production. That is a deliberate stub, not a pattern to copy.

Your own route authenticates its own session first and derives the tenant and tenant-local user IDs from it. Everything the token asserts about who is chatting comes from that decision, so a route that trusts a request body is a route that lets any caller impersonate any user.

## Host tools

A tool is a name, a description, a JSON schema for its input, and a function that runs in the page.

```tsx
const tools: Record<string, ToolDefinition> = {
  create_todo: {
    metadata: { title: "Create a todo" },
    description: "Create a new todo and append it to the list.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "What needs to be done" } },
      required: ["text"],
    },
    execute: (input) => {
      const todo = createTodoFromToolInput({ id: nextTodoId.current++, input })
      setTodos((current) => [...current, todo])
      return { created: todo }
    },
  },
}
```

The consequences are worth being clear about.

- The agent can only do what you declare. There is no ambient access to your application, and a tool you remove is a capability the agent loses immediately.
- `execute` runs with the agent's authority in the user's page, so the input is model-chosen, not user-typed. Validate it and reject what does not make sense, exactly as the example does before it touches state.
- Whatever `execute` returns goes back into the conversation, so return the minimum the agent needs rather than your whole store.
- Read current state through a ref rather than a captured closure, or a long conversation will act on a stale snapshot.

## Inline widgets

A widget is the same idea for output. You declare a schema and a `render` function, and the agent can place that component in the transcript.

```tsx
widgets={{
  todoCard: {
    description: "A single todo from the host app, addressed by its id",
    parameters: {
      type: "object",
      properties: { id: { type: "number", description: "Id of the todo to render" } },
      required: ["id"],
    },
    render: ({ id }) => {
      const todo = todos.find((candidate) => candidate.id === Number(id))
      return todo && <TodoCard title={todo.text} onToggle={() => onToggleTodo(todo.id)} />
    },
  },
}}
```

The agent chooses which todo to show. Your `render` decides what that means and what the user can do with it, which is why the projected card can carry a working toggle. Because the render reads host state, editing the list outside the chat updates cards the agent placed earlier in the conversation.

Address host data by ID rather than passing its contents through the model. A card that looks its subject up cannot drift from the real record, and nothing sensitive has to travel through the transcript.

## Attachments

Paste a screenshot or attach the sample CSV, then ask the agent about it. Attachment bytes belong to that one request and are never added to the system prompt, so the agent reads them as user-supplied material through a tool.

Attachments only work when the agent allows them. That switch lives with the agent and the chat endpoint enforces it, so turning it off refuses files even if the client still sends them.

## Sandbox

Select a tested sandbox provider on the agent and the agent gains sandbox tools. Each conversation gets its own isolated sandbox, so work in one conversation cannot be seen from another, and nothing survives into the next one.

Ask it to export the todos as CSV. Published files come back as short-lived download tickets rather than as bytes in the transcript, and the example's sandbox panel shows the commands, their exit codes, and the resulting downloads.

## Automated checks

`deno task e2e` from `examples/todos` drives the whole thing in a browser against a seeded database, including the token round trip and the chat endpoint's authorization boundary. It needs the seeded database, so it stays out of the default checks.

## Next

- [Quickstart](./quickstart.md), the same integration without the example application.
- [Tools and widgets](/docs/sdk/tools-and-widgets), the full contract for both.
- [Attachments](/docs/sdk/attachments) and [Sandbox](/docs/sdk/sandbox), the reference for each.
- [SDK security model](/docs/sdk/security), the boundaries these features sit inside.
