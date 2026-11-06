# Customize your setup

Once your first message gets a reply, it's time to make the assistant your own. This page collects the changes most teams make next, roughly in the order they need them.

Your organization starts with a working setup:

- A starter agent with general-purpose instructions.
- An **OpenAI** connection with GPT-6.1 Terra, assigned to that agent.
- An enabled **Monthly spend** limit of $10 per calendar month, shared by the whole organization.

## Identify your real users

The dashboard guide signs every token with the test IDs `test-user` and `test-org`, so everyone shares one conversation history. Its examples refuse requests in production until you change them. Before going live, let's read both IDs from your signed-in session:

1. Set `user.id` to the signed-in person's stable ID from your database.
2. Set `tenant.id` to the customer account, workspace, or organization they belong to. Users with the same tenant share its directory and usage limits.
3. Return an authentication error when there is no valid session, then remove the example's production check.

Never read these IDs from the request body, because anyone could then chat as anyone else. See [Authentication](/docs/sdk/authentication) for complete examples, other languages, and switching workspaces.

## Shape your agent

Open **Agents** and choose the starter agent. Rewrite its system prompt to describe your product, its users, and what the assistant should and shouldn't do. You can also turn file attachments and web access on or off, and create more agents for different parts of your app.

See [Agents](/docs/dashboard/agents) for every option, and [The system prompt](/docs/dashboard/agents#the-system-prompt) for writing tips.

## Choose your models

The starter **OpenAI** connection lets you try chat without a provider account. To use your own account, another provider, or a gateway such as OpenRouter, open **Models** and either replace the starter key or add a provider. Then assign the model to your agent.

See [Models](/docs/dashboard/models).

## Control spend

The starter limit refuses new messages once the organization has spent $10 in a calendar month (UTC). Open **Usage Limits** to raise it, or add per-tenant, per-user, or per-conversation limits that match your pricing plans.

See [Usage limits](/docs/dashboard/usage-limits).

## Match your brand

Pass a `title` and theme options to the widget so it looks like part of your app. You can set the color scheme, override theme tokens, or add custom CSS.

See [Theming](/docs/sdk/theming) and [Configuration](/docs/sdk/configuration).

## Work with your app's data

Let the assistant read and change records through functions in your frontend, using the signed-in user's own permissions, and show results as live components in the chat.

See [Tools and widgets](/docs/sdk/tools-and-widgets), or follow the [Todos tutorial](./todos-tutorial.md) to build both end to end.

## Add more capabilities

- [Attachments](/docs/sdk/attachments) let users share images, PDFs, and documents.
- [MCP servers](/docs/dashboard/connections) connect the agent to remote tools such as your issue tracker or CRM.
- [Sandboxes](/docs/dashboard/sandboxes) let the agent run code and produce files.
- [Directories](/docs/sdk/listings) show a tenant's users and saved conversations in your app.

## Before you go live

1. Replace the test IDs, as described in [Identify your real users](#identify-your-real-users).
2. Keep `ASTRALBEAM_API_KEY` in your server's secrets, never in browser code or version control.
3. Review the [security model](/docs/sdk/security) before connecting tools that change data.
4. Check that your usage limits match what you're willing to spend.
