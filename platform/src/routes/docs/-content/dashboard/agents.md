# Agents

An agent defines the instructions, models, and capabilities used by embedded chat. Let's configure one and test it in your application.

## Create and test an agent

1. Add and test a provider under [Models](./models.md).
2. Open **Agents** and edit the starter agent, or choose **Add agent**.
3. Enter a name and system prompt. Select at least one model and choose the **Default model**.
4. Review attachments, Web access, and Sandbox, then choose **Create agent** or **Save changes**.
5. Test the agent in your app. If it is not the organization's default, pass its public ID as `agentId` before sending a message.

The [Quickstart](/docs/start/quickstart) walks through mounting the assistant with the [default agent](#the-default-agent).

## What an agent holds

| Setting | Purpose |
| --- | --- |
| Name | Dashboard label, up to 100 characters and unique within the organization ignoring case. It is not sent to the widget or model |
| System prompt | Required instructions, up to 32,768 characters |
| Models | Enabled provider models, with one default |
| File attachments | Allowed by default. Turning this off refuses new files |
| Tools | Web access and an optional sandbox connection |

New agents enable Web access when their default model supports it, and Sandbox when a connection is available. Existing agents keep their saved choices. Changes apply to the next request, including in open conversations.

## Model selection

Assign enabled provider models and choose one default. The provider name distinguishes connections to the same upstream model. Multiple selections do not enable automatic fallback.

Remove a model from its agents before disabling it on the provider. Provider credentials determine billing. See [Models](./models.md).

## The public agent ID

Copy `agent_<organizationId>_<id>` from the agent page. It is immutable and safe in browser code: it selects an agent but grants no access. The agent and token must belong to the same organization.

## The system prompt

Set instructions in the dashboard. They apply to the next request, including in open conversations, within the deployment's policy. Browser-supplied system prompts are rejected.

## File attachments

**File attachments** controls whether the agent accepts files. Disabling it hides the attach button and makes the endpoint reject uploads.

SDK options can narrow supported files and sizes, but cannot raise deployment limits. See [Attachments](/docs/sdk/attachments) and [Limits](/docs/sdk/limits).

## Web access

Web access lets the agent search and read public pages through its model connection. It supports OpenAI Responses, Anthropic Messages, xAI Grok web search, and OpenRouter's managed server tools. OpenAI Chat Completions requires switching the connection to Responses. Google Gemini connections do not offer web access yet. Custom models and endpoints require explicit opt-in, and an unsupported configuration reports an error.

Answers show clickable citations and consulted sources, which remain available in saved conversations. Tenant users cannot enable this grant from the embedded chat. Model-provider charges may include web-tool fees.

## Sandboxes

Enable **Sandbox**, select a connection, and save. The first tool call provisions a workspace for that agent, conversation, and tenant user. Saved attachments are copied into it for the run.

Workspaces are temporary. Published files remain available after cleanup. If the agent stops offering code execution, [test the provider](./sandboxes.md#connection-tests). See [Sandbox](/docs/sdk/sandbox).

## The default agent

New organizations start with a default starter agent. Assign it a model before using chat.

Changing the default affects new conversations that omit `agentId`. Existing conversations retain their agent. Deleting the default clears it, so choose a replacement before starting more conversations.

## Deleting an agent

**NOTE**: deletion is immediate and cannot be undone.

The public agent ID stops resolving at once. To start a new conversation, repoint the application at another agent or drop the option to fall back to the default.

Deleting the default agent also clears the default, so set another one before creating conversations without an explicit agent ID.

Saved conversations remain readable after their agent is deleted, but cannot continue.

## Who can change agents

Owners and developers can read agents and create, edit, and delete them. Viewers cannot open the agent pages at all and are returned to the organization home. See [Members](./members.md).
