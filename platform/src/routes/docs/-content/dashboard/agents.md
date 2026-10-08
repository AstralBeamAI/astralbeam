# Agents

An agent is one named configuration the embedded chat runs with: its instructions, models, file attachments, web access, and sandbox. Let's configure an agent, then use its public ID to select it in your application.

Each agent selects models from the organization's configured providers and uses one as its default. Request, attachment, and sandbox caps still come from the deployment's [Limits](/docs/sdk/limits).

## What an agent holds

Let's walk through the settings that make up an agent.

The name is up to 100 characters and unique within the organization ignoring case. It stays in the dashboard, as it never reaches the widget or the model.

The system prompt holds the agent's instructions, up to 32,768 characters, and every agent needs one.

Models come from providers configured in [Models](./models.md). Select at least one enabled model, then choose the default model. The provider name distinguishes the same upstream model configured with different keys or API URLs.

File attachments are allowed by default. Turn the setting off and the agent refuses files.

Web access lets the selected model search the web and read public URLs. When creating an agent, the form selects a known search-capable model when available and enables Web access when all selected models support it. You can turn it off in **Tools**. Custom model IDs require opting in because their capabilities are verified by the provider when used.

Sandbox lets the agent write and run code. It starts enabled when the organization has a configured [sandbox connection](./sandboxes.md). Choose its connection or turn it off in **Tools**. Existing agents keep their saved tool settings.

You can change these settings later, and a change applies to the next request rather than to a reply already streaming.

## Model selection

Let's give the agent its models.

1. Open **Models**, add a named provider, and enable the models the agent should use.
2. Open the agent, select models from those providers, and choose its default model.
3. Save the agent. New chat requests use the selected default and the credentials of that model's provider.

The default is a model choice for this agent, separate from the organization's default agent. Selecting several models does not enable automatic fallback between providers. Models assigned to an agent must be removed from that agent before they can be disabled on their provider.

**NOTE**: model usage is billed to the provider account whose credentials the selected model uses. Adding two OpenAI connections lets you separate accounts, keys, or API URLs without changing the upstream model ID.

## The public agent ID

The ID is assigned when the agent is created and never changes. It has the form `agent_<organizationId>_<id>`, and it is safe in browser code because it names an agent without authorizing anything. Pass it as the SDK's `agentId` option, or omit that option to get the organization's default agent.

The chat endpoint honors an agent ID only from the organization whose API key signed the request's chat auth token. An ID belonging to another organization, a malformed ID, and an ID that no longer exists all answer identically, so nobody learns anything about another organization by guessing.

## The system prompt

Your prompt lives here, not in the embedding application. An application that sends a `systemPrompt` with a chat request is refused rather than ignored, so a tenant user cannot rewrite an agent's instructions from the browser and cannot be misled into believing they did.

The deployment supplies its own instructions first, plus an attachment policy when the turn carries files and sandbox instructions when the agent has a sandbox. Your prompt is applied last, so it shapes that behavior rather than replacing it.

Editing a prompt takes effect on the next request from every application using that agent. Open conversations keep their transcript and pick up the new prompt on their next turn, which can read as a mid-conversation change of personality.

## File attachments

The attachment setting is enforced at the chat endpoint rather than in the widget. The widget asks the endpoint what the selected agent allows and hides its attach button when the answer is no, and an application that sends files anyway has that turn refused instead of quietly dropping the files.

While attachments are on, the accepted types, per-file sizes, and per-message count come from the deployment. An SDK option can narrow them for your users but never widen them. See [Attachments](/docs/sdk/attachments) and [Limits](/docs/sdk/limits).

## Web access

Let's review **Web access** under **Tools** when your users need current information or answers from public URLs. The grant belongs to the agent, so an embedded browser client cannot enable it or replace its web tools.

Web access uses the selected model's existing connection. Choose OpenAI Responses, Anthropic Messages, or OpenRouter Chat Completions and a model that supports web tools. OpenRouter manages retrieval and may use an external search engine. An unsupported configuration fails with guidance to change the model or protocol. OpenAI Chat Completions requires switching the connection to Responses.

Citations link evidence to answer text, and web activity lists consulted sources separately. Both remain available in saved conversations and read-only transcripts. If you switch providers or models, follow-ups retain source links and available excerpts, while private provider evidence stays with its original connection and model.

**NOTE**: web tools may add charges to the selected provider's bill. Each provider request permits up to five native calls, or five calls per tool when the provider exposes only a per-tool limit. Long Anthropic web operations share the existing model-turn budget. AstralBeam does not retry through a different provider.

## Sandboxes

Enabling **Sandbox** and selecting its connection gives the agent its file and command tools. The agent gets one isolated sandbox per conversation, provisioned the first time it actually reaches for a tool, and files sent in that conversation are written into it.

When the provider's configuration cannot be read as a run starts, the sandbox tools and their instructions drop together and the agent answers without them rather than failing.

**TIP**: an agent that has quietly stopped offering to run code is usually a provider problem, so check its connection state in [Sandboxes](./sandboxes.md) first.

A sandbox is scratch space. It is reclaimed once it sits idle, and the next turn provisions a fresh, empty one. See [Sandbox](/docs/sdk/sandbox).

## The default agent

The default agent answers every chat request that carries no agent ID. A new organization is created with a starter agent, already set as its default. Let's configure a provider and assign a model to that starter agent before mounting the widget.

Changing the default affects only requests that send no agent ID. Applications pinning an ID are untouched, so moving them to a new agent is an application change rather than a dashboard change.

If the organization has no default agent, requests without an agent ID fail and say so. You land in that state after deleting the agent that was the default.

## Deleting an agent

**NOTE**: deletion is immediate and cannot be undone.

The public agent ID stops resolving at once, so any application still sending it loses its chat until you repoint it at another agent or drop the option to fall back to the default.

Deleting the agent that was the default also clears the default, so set another one or every request without an agent ID keeps failing.

Saved conversations remain readable after deletion. Start a new conversation with another agent to continue chatting.

## Who can change agents

Owners and developers can read agents and create, edit, and delete them. Viewers cannot open the agent pages at all and are returned to the organization home. See [Members](./members.md).

Two people editing the same agent cannot overwrite each other. The second save is rejected because it started from a stale copy, and the page reloads with the current values, which discards edits you had not saved.

**TIP**: copy a long prompt somewhere safe before you reload after a rejected save.
