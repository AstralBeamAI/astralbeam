# Todos example

Follow the [Todos tutorial](../../platform/src/routes/docs/-content/start/todos-tutorial.md) to rebuild the assistant from a plain app.

A TanStack Start app demonstrating the SDK chat sidebar and tenant-user listing, host tools, inline `TodoCard` widgets, attachments, and the optional sandbox panel. Its plain CSS stays separate from the widgets' shadow-root styles.

Tasks are saved in this browser's localStorage, so edits and inline cards survive reloads. This storage belongs to the fixed demo user and does not sync across devices. Production applications should persist their own task data under the authenticated user's identity.

## Demo agent prompt

Use the todos agent prompt from [`platform/scripts/seed/fixtures.ts`](../../platform/scripts/seed/fixtures.ts). `db-seed` installs it automatically. For manual setup, copy it into the agent in the dashboard.

## Run

Complete the repository [setup](../../SETUP.md) first to install dependencies, build the SDK, and prepare the local platform. `bun run --cwd platform db-seed` creates the `acme` organization, todos agent, Docker sandbox provider, API key, and directory records. It writes `examples/todos/.env` only if that file is absent. Start the platform with `bun run --cwd platform dev` and, in another terminal, run `bun run --cwd examples/todos dev`. Open <http://localhost:4700>.

For manual configuration:

1. In the platform, use the organization's starter agent (already the default) or create one on the agents page, and set its system prompt to the demo prompt above. Prompts are agent configuration. The SDK cannot override them.
2. Optionally configure and test a sandbox provider on the **Sandboxes** page, then select it on the agent. The endpoint gives that agent sandbox tools, and the demo prompt asks it to use them.
3. Create an organization API key and copy the one-time `key_<organizationId>_<id>_abo_<secret>` value.
4. Copy `.env.example` to `.env.local` and configure the confidential API key on the server. Leave `VITE_ASTRALBEAM_AGENT_ID` empty to use the organization's default agent, or set the browser-safe agent ID shown on the agents page. The API key and agent must belong to the same organization. Never commit `.env.local`.
5. For chat, add a connection under **Models**, enable a model, and select it on the agent. The seed does this with `OPENAI_API_KEY` when the organization has no provider yet. Existing provider choices stay unchanged. The tenant-user listing needs no model or sandbox.
6. For the listing, provision a Tenant with `external_id: "todos-tenant-1"` and a TenantUser with `external_id: "todos-user-1"` under it in the API key's Organization. Use the [directory provisioning example](https://astralbeam.ai/docs/sdk/listings) with these IDs, which match [`src/lib/constants.server.ts`](src/lib/constants.server.ts).

## Try it

- Open **Users** (`/tenant-users`) to browse the current tenant's users. It shares the chat token endpoint and uses the SDK's default tenant scope. The demo user's signed admin claim permits reading and writing TenantUsers through the API, although the widget itself is read-only. It grants no access to other tenants or dashboard administration.
- Enable **Show stored admin fields** to reveal the optional column and filter. Metadata appears in its own column. The tenant comes from the signed JWT, with no tenant picker or organization token.
- Toggle **Hide assistant**, **Theme**, and **Custom theme** to compare layout and palettes.
- Ask the assistant to edit todos, then toggle a `TodoCard` inside the chat and confirm the host list updates.
- Paste a screenshot or attach `samples/tasks.csv` and ask the assistant to create todos or analyze the table.
- With a sandbox provider, ask it to export your todos as CSV. Inspect file downloads, command output, and exit codes in the **Sandbox** panel.

The demo token route grants a fixed identity and returns `503` in production. Before deploying, replace it with a handler that derives stable Tenant and tenant-local user IDs from an authenticated session. Follow the [SDK authentication guide](https://astralbeam.ai/docs/sdk/authentication).

## Automated checks

`bun run e2e` runs deterministic browser checks against a seeded database. With `OPENAI_API_KEY` and a configured model, it also runs real-agent checks that spend provider credits. See the [suite guide](e2e/README.md) for setup and coverage.

After changing SDK sources, run `bun run --cwd sdk build` from the repository root and reload the page.
