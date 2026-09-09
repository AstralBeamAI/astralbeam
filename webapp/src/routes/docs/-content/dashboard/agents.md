# Agents

An agent is one named configuration the embedded chat runs with: its instructions, whether it accepts file attachments, and whether it can run code in a sandbox. Your application selects an agent by its public ID, so one organization can serve several chat experiences from a single integration.

An agent holds no model choice and no limits of its own. Every run uses the deployment's model and the caps in [Limits](/docs/sdk/limits).

## What an agent holds

| Setting          | Rule                                                                     | What it affects                                                     |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Name             | Required, up to 100 characters, unique in the organization ignoring case | The dashboard only. The name never reaches the widget or the model. |
| System prompt    | Required, up to 32,768 characters                                        | How the agent behaves on every run                                  |
| File attachments | On by default                                                            | Whether tenant users can send this agent files                      |
| Sandbox provider | Optional, one of the organization's [sandbox providers](./sandboxes.md)  | Whether the agent can write and run code                            |

Everything except the public ID can be changed later, and a change applies to the next request rather than to a reply already streaming.

## The public agent ID

The ID is assigned when the agent is created and never changes. It has the form `agent_<organizationId>_<id>`, and it is safe in browser code because it names an agent without authorizing anything. Pass it as the SDK's `agentId` option, or omit that option to get the organization's default agent.

The chat endpoint honors an agent ID only from the organization whose API key signed the request's chat auth token. An ID belonging to another organization, a malformed ID, and an ID that no longer exists all answer identically, so nothing can be learned about another organization by guessing.

## The system prompt

The prompt lives here, not in the embedding application. An application that sends a `systemPrompt` with a chat request is refused rather than ignored, so a tenant user cannot rewrite an agent's instructions from the browser and cannot be misled into believing they did.

The deployment supplies its own instructions first, plus an attachment policy when the turn carries files and sandbox instructions when the agent has a sandbox. Your prompt is applied last, so it shapes that behavior rather than replacing it.

Editing a prompt takes effect on the next request from every application using that agent. Open conversations keep their transcript and pick up the new prompt on their next turn, which can read as a mid-conversation change of personality.

## File attachments

The attachment setting is enforced at the chat endpoint, not in the widget. The widget asks the endpoint what the selected agent allows and hides its attach button when the answer is no. An application that sends files anyway has that turn refused instead of quietly dropping the files.

While attachments are on, the accepted types, per-file sizes, and per-message count come from the deployment. An SDK option can narrow them for your users but never widen them. See [Attachments](/docs/sdk/attachments) and [Limits](/docs/sdk/limits).

## Sandboxes

Selecting a sandbox provider is what gives an agent its file and command tools. The agent gets one isolated sandbox per conversation, provisioned the first time it actually reaches for a tool, and files sent in that conversation are written into it.

When the provider's configuration cannot be read as a run starts, the sandbox tools and their instructions drop together and the agent answers without them rather than failing. The symptom is an agent that has quietly stopped offering to run code, so check the provider's connection state in [Sandboxes](./sandboxes.md).

A sandbox is scratch space. It is reclaimed after it sits idle, and the next turn provisions a fresh, empty one. See [Sandbox](/docs/sdk/sandbox).

## The default agent

The default agent answers every chat request that carries no agent ID. A new organization is created with a starter agent, already set as its default, so an application can mount the widget before anyone opens the dashboard.

Changing the default affects only requests that send no agent ID. Applications that pin an ID are untouched, which also means moving them to a new agent is an application change, not a dashboard change.

If the organization has no default agent, requests without an agent ID fail and say so. That is the state you land in after deleting the agent that was the default.

## Deleting an agent

Deletion is immediate and cannot be undone. The public agent ID stops resolving at once, so any application still sending it loses its chat until you repoint it at another agent or drop the option to fall back to the default.

Deleting the agent that was the default also clears the default. Set another one, or every request without an agent ID keeps failing.

Transcripts are not stored, so nothing is lost with the agent beyond its configuration.

## Who can change agents

Owners and developers can read agents and create, edit, and delete them. Viewers cannot open the agent pages at all and are returned to the organization home. See [Members](./members.md).

Two people editing the same agent cannot overwrite each other. The second save is rejected because it started from a stale copy, and the page reloads with the current values, which discards edits you had not saved. Copy a long prompt somewhere safe before reloading.
