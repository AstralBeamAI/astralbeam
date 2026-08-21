# Todos example

A deliberately barebones Vite + React todos app that embeds the AstralBeam chat sidebar from the built SDK. It consumes `@astralbeam/sdk` through a `file:../..` dependency, so imports resolve through the package `exports` to `sdk/dist` — the same artifacts a published install would use.

The app uses plain CSS with no Tailwind or shadcn/ui. That is the point: the chat widget's Tailwind-based UI lives entirely inside its shadow root, and the only host UI in the conversation is the app's own `TodoCard`, registered as the `todoCard` widget so the agent can render it inline with props it chooses, while live app state and handlers keep working.

## Run

1. Build the SDK first: `deno task build` from `sdk`.
2. From this directory: `deno install`, then `deno task dev`.
3. Open http://localhost:3100. Toggle the sidebar with "Hide assistant", press send to play the scripted conversation, and toggle the todo inside the chat to see host state update.

After changing SDK sources, rebuild from `sdk` and reload the page.
