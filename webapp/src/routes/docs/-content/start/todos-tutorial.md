# Todos tutorial

Let's walk through the todos example, a small application whose agent edits the list the user is looking at. It is the shortest way to see the four integration points that matter: host tools, inline widgets, attachments, and a sandbox.

The code lives in `examples/todos` in the repository, and it demonstrates four things:

- The agent reads and writes the host application's state through tools that run in the page, rather than through an API you expose to it.
- The agent renders your own components inside the transcript, and those renders stay live as host state changes.
- A user can paste an image or attach a file, and the agent can use it for that request only.
- With a sandbox provider on the agent, the agent can run commands and publish files the user downloads.

## 1. Seed the local data

Run this command from the repository root to create an organization, a todos agent, a sandbox provider, and an API key:

```sh
deno task --cwd webapp db-seed
```

It also writes `examples/todos/.env` when that file does not already exist, so the example points at the database you just seeded.

**NOTE**: To set this up by hand instead, create an agent with the demo prompt, optionally configure a sandbox provider and select it on the agent, create an API key, and copy `.env.example` to `.env`.

The example reads three variables. `ASTRALBEAM_API_KEY` is server only and is the key the token route signs with. `VITE_ASTRALBEAM_AGENT_ID` is optional, and leaving it empty uses the organization's default agent. `VITE_ASTRALBEAM_API_URL` is optional and defaults to the local webapp's `/api` base.

The API key and the agent must belong to the same organization, as a key cannot resolve another organization's agent.

## 2. Run the example

Start the webapp on port 4500 with `deno task dev` from `webapp`, then build the SDK with `deno task build` from `sdk`. From `examples/todos`, run `deno install` followed by `deno task dev` and open `http://localhost:4700`.

You should see the todo list with the assistant sidebar beside it, and controls along the top for hiding the assistant and switching themes.

## 3. Mint tokens for a real user

The example ships a token route that mints for one fixed demo identity and refuses to run in production. That is a deliberate stub, not a pattern to copy.

Your own route must authenticate its own session first and derive the tenant and tenant-local user IDs from it. Everything the token asserts about who is chatting comes from that decision, so a route that trusts a request body lets any caller impersonate any user.

## 4. Give the agent tools

A tool is a name, a description, a JSON schema for its input, and a function that runs in the page. Here is how the example declares the tool that creates a todo:

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

The agent can only do what you declare. There is no ambient access to your application, so a tool you remove is a capability the agent loses immediately.

`execute` runs with the agent's authority in the user's page, and its input is model-chosen rather than user-typed, so validate it and reject what does not make sense, as the example does before it touches state. Whatever `execute` returns goes back into the conversation, so return the minimum the agent needs rather than your whole store.

**TIP**: Read current state through a ref rather than a captured closure, or a long conversation will act on a stale snapshot.

## 5. Draw into the transcript

A widget is the same idea for output. You declare a schema and a `render` function, and the agent can place that component in the transcript:

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

Ask the assistant to show you a todo and it picks which one. Your `render` decides what that means and what the user can do with it, which is why the projected card carries a working toggle. Because the render reads host state, editing the list outside the chat updates cards the agent placed earlier in the conversation.

Address host data by ID rather than passing its contents through the model. A card that looks its subject up cannot drift from the real record, and nothing sensitive has to travel through the transcript.

## 6. Attach a file

Paste a screenshot or attach `samples/tasks.csv`, then ask the assistant about it. Attachment bytes belong to that one request and are never added to the system prompt, so the agent reads them as user-supplied material through a tool.

Attachments only work while the agent allows them. That setting lives with the agent and the chat endpoint enforces it, so turning it off refuses files even when the client still sends them.

## 7. Add a sandbox

Select a tested sandbox provider on the agent and the agent gains file and command tools. Each conversation gets its own isolated sandbox, so work in one conversation cannot be seen from another and nothing survives into the next one.

Ask it to export the todos as CSV. Published files come back as short-lived download tickets rather than as bytes in the transcript, and the example's sandbox panel shows the commands, their exit codes, and the resulting downloads.

## Automated checks

Run `deno task e2e` from `examples/todos` to drive all of the above in a browser against the seeded database, including the token round trip and the chat endpoint's authorization boundary. It needs that database, so it stays out of the default checks.

## Next

- [Quickstart](./quickstart.md), the same integration without the example application.
- [Tools and widgets](/docs/sdk/tools-and-widgets), the full contract for both.
- [Attachments](/docs/sdk/attachments) and [Sandbox](/docs/sdk/sandbox), the reference for each.
- [SDK security model](/docs/sdk/security), the boundaries these features sit inside.
