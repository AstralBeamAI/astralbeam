# Todos example

A TanStack Start app demonstrating the SDK sidebar, host tools, inline `TodoCard` widgets, attachments, and the optional sandbox panel. Its plain CSS stays separate from the widget's shadow-root styles.

## Demo agent prompt

Use the todos agent prompt from [`webapp/scripts/seed/fixtures.ts`](../../webapp/scripts/seed/fixtures.ts). `db-seed` installs it automatically. For manual setup, copy it into the agent in the dashboard.

## Run

The quickest path is `deno task --cwd webapp db-seed`, which creates the `acme` organization with a `todos` agent already carrying the prompt above, a Docker sandbox provider, and an API key, then writes `examples/todos/.env` for this example when that file does not exist yet, leaving an existing one alone. The numbered steps below are the same setup done by hand.

1. In the webapp, use the organization's starter agent (already the default) or create one on the agents page, and set its system prompt to the demo prompt above. Prompts are agent configuration. The SDK cannot override them.
2. Optionally configure and test a sandbox provider on the **Sandboxes** page, then select it on the agent. The endpoint gives that agent sandbox tools, and the demo prompt asks it to use them.
3. Create an organization API key and copy the one-time `key_<organizationId>_<id>_abo_<secret>` value.
4. Copy `.env.example` to `.env` and configure the confidential API key on the server. Leave `VITE_ASTRALBEAM_AGENT_ID` empty to use the organization's default agent, or set the browser-safe agent ID shown on the agents page. The API key and agent must belong to the same organization.
5. Start the webapp on port 4500 (`deno task dev` from `webapp`) with `OPENAI_API_KEY` configured. It verifies authenticated requests at `/api/v1/chat`.
6. Build the SDK with `deno task build` from `sdk`.
7. From this directory, run `deno install` and `deno task dev`, then open <http://localhost:4700>.

## Try it

- Toggle **Hide assistant**, **Theme**, and **Custom theme** to compare layout and palettes.
- Ask the assistant to edit todos, then toggle a `TodoCard` inside the chat and confirm the host list updates.
- Paste a screenshot or attach `samples/tasks.csv` and ask the assistant to create todos or analyze the table.
- With a sandbox provider, ask it to export your todos as CSV. Inspect file downloads, command output, and exit codes in the **Sandbox** panel.

The demo token route grants a fixed identity and returns `503` in production. Before deploying, replace it with a handler that derives stable Tenant and tenant-local user IDs from an authenticated session. Follow the [SDK authentication guide](https://app.astralbeam.ai/docs/sdk/authentication).

## Automated checks

`deno task e2e` drives this example in a browser against a seeded database: the host UI, the token round-trip, the chat endpoint's authorization boundary, the agent's tools and widgets, attachments, and the sandbox. See [`e2e/README.md`](e2e/README.md) for how to run it, what each folder owns, and what to update when the SDK or this app changes.

After changing SDK sources, rebuild from `sdk` and reload the page.
