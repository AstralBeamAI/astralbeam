# Todos example

A deliberately barebones TanStack Start todos app that embeds the AstralBeam chat sidebar from the built SDK. It consumes `@astralbeam/sdk` through a `file:../../sdk` dependency, so imports resolve through the package `exports` to `sdk/dist` — the same artifacts a published install would use.

The app uses plain CSS with no Tailwind or shadcn/ui. That is the point: the chat widget's Tailwind-based UI lives entirely inside its shadow root, and the only host UI in the conversation is the app's own `TodoCard`, registered as the `todoCard` widget so the agent can render it inline with props it chooses, while live app state and handlers keep working.

The chat talks to a real agent: the app points `chatEndpoint` at the webapp's `/api/chat`, supplies a TanStack Start server route as its `authEndpoint` to mint a short-lived token for a fixed demo user and tenant, passes a todo-specific `systemPrompt`, and registers `get_todos`, `create_todo`, `update_todo`, and `delete_todo` tools that execute against the app's own React state.

## Run

1. Generate one 32+ byte `ASTRALBEAM_CHAT_AUTH_SECRET` and set the same value in `webapp/.env` and this example's `.env` (copy `.env.example`), or in the shells that launch them.
2. Start the webapp on port 3000 (`deno task dev` from `webapp`) with `OPENAI_API_KEY` set in `webapp/.env`; it verifies authenticated requests at `/api/chat`.
3. Build the SDK: `deno task build` from `sdk`.
4. From this directory: `deno install`, then `deno task dev`.
5. Open http://localhost:3100. Toggle the sidebar with "Hide assistant", cycle "Theme" through system/light/dark to retheme the app (plain CSS variables) and the widget (`colorScheme` prop) from one preference — each side resolves "system" against the OS setting live — and flip "Custom theme" to compare the widget's stock palette with the `theme` prop retuning its shadcn tokens to the app's parchment palette. The action buttons sit below the todo list. Ask the assistant about your todos: it lists and edits them through the registered tools, and renders a `TodoCard` widget inline for every todo it shows, one per id. Toggle the todo inside the chat to see host state update.

After changing SDK sources, rebuild from `sdk` and reload the page.
