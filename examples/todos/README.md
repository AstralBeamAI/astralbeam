# Todos example

A deliberately barebones TanStack Start todos app that embeds the AstralBeam chat sidebar from the built SDK. It consumes `@astralbeam/sdk` through a `file:../../sdk` dependency, so imports resolve through the package `exports` to `sdk/dist` — the same artifacts a published install would use.

The app uses plain CSS with no Tailwind or shadcn/ui. That is the point: the chat widget's Tailwind-based UI lives entirely inside its shadow root, and the only host UI in the conversation is the app's own `TodoCard`, registered as the `todoCard` widget so the agent can render it inline with props it chooses, while live app state and handlers keep working.

The chat talks to a real organization-owned agent: the app points `chatEndpoint` at the webapp's `/api/chat`, supplies a TanStack Start `/api/chat/token` route as its `authEndpoint`, mints a short-lived JWT from an organization API key for a fixed demo tenant user, passes a todo-specific `systemPrompt`, and registers `get_todos`, `create_todo`, `update_todo`, and `delete_todo` tools that execute against the app's own React state.

Attachments need no wiring — the composer takes them by default — so the app only tells the agent what to do with them: its `systemPrompt` asks it to turn an attached file or screenshot into todos through those same tools.

The sandbox needs no wiring either, and this app neither configures nor knows about it.

Selecting a sandbox provider on the agent is enough for the endpoint to hand it file and command tools.

The widget then shows each file written and each command run, inline and in the **Sandbox** tray above the composer.

## Run

1. In the webapp, use the organization's starter agent, which it already has as its default, or create another one on the agents page. A stored prompt is a default, and this example overrides it with the SDK's browser-supplied `systemPrompt`; neither prompt is a security-policy boundary.
2. Optionally configure and test a sandbox provider on the **Sandboxes** page, then select it on the agent. The endpoint gives that agent sandbox tools, and this example's prompt asks it to use them.
3. Create an organization API key and copy the one-time `key_<organizationSlug>_<keySlug>_abo_<secret>` value.
4. Copy `.env.example` to `.env` and configure the confidential API key on the server. Leave `VITE_ASTRALBEAM_AGENT_ID` empty to use the organization's default agent, or set the browser-safe agent ID shown on the agents page. The organization slug in the key and agent IDs must match.
5. Start the webapp on port 4500 (`deno task dev` from `webapp`) with `OPENAI_API_KEY` configured; it verifies authenticated requests at `/api/chat`.
6. Build the SDK with `deno task build` from `sdk`.
7. From this directory, run `deno install` and `deno task dev`, then open http://localhost:4700. Toggle the sidebar with "Hide assistant", cycle "Theme" through system/light/dark to retheme the app (plain CSS variables) and the widget (`colorScheme` prop) from one preference — each side resolves "system" against the OS setting live — and flip "Custom theme" to compare the widget's stock palette with the `theme` prop retuning its shadcn tokens to the app's parchment palette. Ask the assistant about your todos: it lists and edits them through the registered tools, and renders a `TodoCard` widget inline for every todo it shows, one per id. Toggle the todo inside the chat to see host state update. Then attach something — paste a screenshot of a list, or drop a `.md` or `.csv` file of tasks on the composer — and ask the assistant to add them: the file rides inline with the message, and the todos it creates come back as `TodoCard` widgets.
8. With a sandbox provider on the agent, ask it for something that needs code: "write a script that exports my todos as CSV and run it".
9. Each sandbox step appears as an expandable row. The **Sandbox** tray above the composer holds every file it wrote and the whole command log.

The token route is local-demo-only: it is intentionally unauthenticated and grants every caller the fixed demo identity, so do not deploy it unchanged. Real hosts must derive a stable, Organization-unique `tenantUser.id` from their authenticated application session, never trust a browser-supplied identity, and avoid secrets because JWT payloads are signed but not encrypted.

After changing SDK sources, rebuild from `sdk` and reload the page.
