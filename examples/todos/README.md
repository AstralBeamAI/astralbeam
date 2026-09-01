# Todos example

A deliberately barebones TanStack Start todos app that embeds the AstralBeam chat sidebar from the built SDK. It consumes `@astralbeam/sdk` through a `file:../../sdk` dependency, so imports resolve through the package `exports` to `sdk/dist` — the same artifacts a published install would use.

The app uses plain CSS with no Tailwind or shadcn/ui. That is the point: the chat widget's Tailwind-based UI lives entirely inside its shadow root, and the only host UI in the conversation is the app's own `TodoCard`, registered as the `todoCard` widget so the agent can render it inline with props it chooses, while live app state and handlers keep working.

The chat talks to a real organization-owned agent: the app points `chatEndpoint` at the webapp's `/api/chat`, supplies a TanStack Start `/api/chat/token` route as its `authEndpoint`, mints a short-lived JWT from an organization API key for a fixed demo tenant user, passes a todo-specific `systemPrompt`, and registers `get_todos`, `create_todo`, `update_todo`, and `delete_todo` tools that execute against the app's own React state.

Attachments need no wiring — the composer takes them by default — so the app only tells the agent what to do with them: its `systemPrompt` asks it to turn an attached file or screenshot into todos through those same tools.

## Run

1. In the webapp, configure and test an organization sandbox provider. The agent records this preference for the later sandbox-execution PR; this example does not execute a sandbox.
2. Create an agent using that provider. Its stored prompt is a default, and this example overrides it with the SDK's browser-supplied `systemPrompt`; neither prompt is a security-policy boundary.
3. Create an organization API key and copy the one-time `key_<organizationSlug>_<keySlug>_<secret>` value.
4. Copy `.env.example` to `.env`. Configure the API key on the server and set the browser-safe `VITE_ASTRALBEAM_AGENT_ID` shown on the agent page. The API key is confidential. The organization slug in the key and agent IDs must match.
5. Start the webapp on port 3000 (`deno task dev` from `webapp`) with `OPENAI_API_KEY` configured; it verifies authenticated requests at `/api/chat`.
6. Build the SDK with `deno task build` from `sdk`.
7. From this directory, run `deno install` and `deno task dev`, then open http://localhost:3100. Toggle the sidebar with "Hide assistant", cycle "Theme" through system/light/dark to retheme the app (plain CSS variables) and the widget (`colorScheme` prop) from one preference — each side resolves "system" against the OS setting live — and flip "Custom theme" to compare the widget's stock palette with the `theme` prop retuning its shadcn tokens to the app's parchment palette. Ask the assistant about your todos: it lists and edits them through the registered tools, and renders a `TodoCard` widget inline for every todo it shows, one per id. Toggle the todo inside the chat to see host state update. Then attach something — paste a screenshot of a list, or drop a `.md` or `.csv` file of tasks on the composer — and ask the assistant to add them: the file rides inline with the message, and the todos it creates come back as `TodoCard` widgets.

The token route is local-demo-only: it is intentionally unauthenticated and grants every caller the fixed demo identity, so do not deploy it unchanged. Real hosts must derive a stable, Organization-unique `tenantUser.id` from their authenticated application session, never trust a browser-supplied identity, and avoid secrets because JWT payloads are signed but not encrypted.

After changing SDK sources, rebuild from `sdk` and reload the page.
