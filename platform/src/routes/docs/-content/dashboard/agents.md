# Agents

An agent gives your assistant its instructions, model, and tools. Start with your organization's starter agent, then create others when you need different behavior.

## Create and test an agent

1. Add and test a provider under [Models](./models.md).
2. Open **Agents** and edit the starter agent, or choose **Add agent**.
3. Enter a name and system prompt. Select at least one model and choose the **Default model**.
4. Choose **Create agent** or **Save changes**.
5. In your app, ask **"What can you help me with?"** and check that the reply follows your instructions. To use an agent other than the default, pass its public ID as `agentId`.

The [Quickstart](/docs/start/quickstart) walks through mounting the assistant with the [default agent](#the-default-agent).

New agents allow file attachments. They also enable Web access when the default model supports it, and Sandbox when a connection is available. Review these capabilities before connecting production data. Saved changes apply to the next request, including in open conversations.

## Model selection

Assign enabled provider models and choose one default. The provider name distinguishes connections to the same upstream model. Multiple selections do not enable automatic fallback.

Remove a model from its agents before disabling it on the provider. Provider credentials determine billing. See [Models](./models.md).

## The public agent ID

Copy `agent_<organizationId>_<id>` from the agent page. It is immutable and safe in browser code: it selects an agent but grants no access. The agent and token must belong to the same organization.

## The system prompt

Describe what the assistant helps with, how it should respond, and when it should ask before acting. For example:

```text
Help customers manage their projects.
Keep replies brief and name the project you are changing.
Ask before deleting a project.
```

Set these instructions in the dashboard. Browser-supplied system prompts are rejected. Your backend must still authorize every action a [host tool](/docs/sdk/tools-and-widgets) performs.

## File attachments

**Allow file attachments** controls whether the agent accepts files. Disabling it hides the attach button and makes the endpoint reject uploads.

SDK options can narrow supported files and sizes, but cannot raise deployment limits. See [Attachments](/docs/sdk/attachments) and [Limits](/docs/sdk/limits).

## Web access

Web access lets the agent search and read public pages. Choose an OpenAI Responses, Anthropic, xAI Grok, or OpenRouter default model. OpenAI Chat Completions and Google Gemini connections do not currently support this capability. Enable it on custom models and endpoints only after checking their native web-tool support.

Answers include citations and sources in saved conversations. Tenant users cannot enable Web access themselves. Provider charges may include web-tool fees.

## Sandboxes

Enable **Sandbox**, select a connection, and save. The first tool call provisions a workspace for that agent, conversation, and tenant user. Saved attachments are copied into it for the run.

Workspaces are temporary. Published files remain available after cleanup. If the agent stops offering code execution, [test the provider](./sandboxes.md#connection-tests). See [Sandbox](/docs/sdk/sandbox).

## The default agent

New organizations start with a default starter agent that replies with GPT-6.1 Terra through the organization's **OpenAI** connection. Rewrite its system prompt to describe your product.

Changing the default affects new conversations that omit `agentId`. Existing conversations retain their agent. Deleting the default clears it, so choose a replacement before starting more conversations.

## Deleting an agent

**NOTE**: Deletion is immediate and cannot be undone. Saved conversations remain readable but cannot continue.

Point your app at a replacement before deleting its agent. If you delete the default, choose another default before starting conversations without `agentId`.

## Who can change agents

Owners and developers can create, edit, and delete agents. Viewers cannot access these pages. See [Members](./members.md).
