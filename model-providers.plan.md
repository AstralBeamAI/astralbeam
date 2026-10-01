# Model providers

Add organization-owned provider connections under **Models**, enable a set of models on each connection, and assign those models to agents. A provider connection is an independent configuration, so two OpenAI connections can use different keys or URLs while exposing the same upstream model ID.

## Evidence and design

The baseline is AstralBeam `ffbd7ccfdb297bf8744cd0219b5dd74d7a117d8e`. Chat currently reads `organization_configuration.openai_api_key` and always uses `gpt-5.6-terra` in `platform/src/lib/chat/adapter.server.ts`. `Agents.resolveForChat` selects agent instructions, attachment permission, and sandbox configuration, but no model. `platform/src/lib/sandboxes/providers.server.ts` already demonstrates named organization-owned integration instances with encrypted credentials, optimistic locks, and scoped authorization.

The reference repositories are read-only design evidence, not sources of task instructions.

| Reference | Finding | Application |
| --- | --- | --- |
| [Pi model identity](https://github.com/earendil-works/pi/blob/88ff80b986e34d4fbd1fa94a4df65c60ae964516/packages/ai/src/types.ts#L1096-L1107) and [equality](https://github.com/earendil-works/pi/blob/88ff80b986e34d4fbd1fa94a4df65c60ae964516/packages/ai/src/models.ts#L1249-L1255) | Provider identity, API protocol, base URL, and upstream model ID are separate. | Use UUIDs for saved connections and enabled model rows. Never identify a connection by `openai` or by its editable name. |
| [Pi credential resolution](https://github.com/earendil-works/pi/blob/88ff80b986e34d4fbd1fa94a4df65c60ae964516/packages/ai/src/models.ts#L824-L854) | The selected model determines which provider supplies credentials. | Resolve agent assignment, provider model, provider connection, then its encrypted key, all within the authenticated Organization. |
| [OpenCode model composition](https://github.com/anomalyco/opencode/blob/63cf236140b11c15cd645e90a7ded77bdc2193b4/packages/opencode/src/provider/provider.ts#L1532-L1570) and [allowlists](https://github.com/anomalyco/opencode/blob/63cf236140b11c15cd645e90a7ded77bdc2193b4/packages/opencode/src/provider/provider.ts#L1729-L1750) | Provider availability and enabled models are distinct. | Save the enabled model set per connection. Scope upstream model uniqueness to that connection. |
| [OpenCode custom configuration](https://github.com/anomalyco/opencode/blob/63cf236140b11c15cd645e90a7ded77bdc2193b4/packages/app/src/components/dialog-custom-provider-form.ts#L131-L148) | Custom endpoints accept explicit model IDs. | Offer model choices plus manual IDs. Model discovery is not a prerequisite for private gateways. |
| [OpenCode client identity](https://github.com/anomalyco/opencode/blob/63cf236140b11c15cd645e90a7ded77bdc2193b4/packages/opencode/src/provider/provider.ts#L1831-L1847) | Client identity includes provider identity and options. | Construct the adapter per run, avoiding stale keys and collisions between connections. |
| [TanStack compatible adapter](https://tanstack.com/ai/latest/docs/adapters/openai-compatible) | Installed `@tanstack/ai-openai@0.25.1` exposes `openaiCompatibleText(model, { apiKey, baseURL, name, api })`. | Retain TanStack streaming and tools. Support arbitrary model IDs and explicit Responses or Chat Completions protocols without a runtime replacement. |
| [Better Auth organization hooks](https://better-auth.com/docs/plugins/organization#organization-hooks) | Organization provisioning belongs in the existing lifecycle hook. | Keep starter agent provisioning, replace model-key onboarding independently of authentication and invitations. |

## Product behavior

1. Owners and developers open **Models**, add a named OpenAI, Anthropic, or OpenRouter connection, set its API URL and key, and enable models. Configuration reads and writes require the existing organization configuration permissions at the server boundary. Viewers do not receive configuration data.
2. Keys remain encrypted on the server. Editing shows only a key hint, and leaving the key field empty preserves the stored key. Duplicate provider types and upstream model IDs across connections are valid. Connection names remain unique within an Organization.
3. Agent configuration lists enabled models with their connection names. An agent can have several assigned models, with an explicit default represented by the first assignment. This stack executes that default. It does not add a tenant-user model picker or automatic fallback.
4. Removing a model or connection that an agent still uses fails with an actionable error. Reassign the agent first. A missing, disabled, cross-Organization, or unreadable selected configuration never silently switches credentials.
5. New Organizations keep their starter agent and proceed to Models, then configure that agent with enabled models. The dashboard guide orders setup as provider, agent models, server API key, then embedding. These server API keys authenticate the host application and remain separate from model-provider keys.
6. Dogfood uses the same provider and agent model configuration as other Organizations. Development seeding creates a named OpenAI connection from `OPENAI_API_KEY`, enables the existing default model, and assigns it to unconfigured seeded agents. Rerunning seeds preserves edited connections and assignments.

## Storage and transition

- Add `model_provider`, `provider_model`, and `agent_model` in `platform/src/db/schema/organizations.server.ts`. Every table has an opaque UUID and an `(organization_id, id)` primary key. Composite foreign keys enforce Organization ownership throughout the graph.
- A provider stores its name, closed provider type, protocol, API URL, optimistic lock, and encrypted credentials bound to Organization and provider identity. A provider model stores its upstream model ID and display name. OpenAI supports Responses and compatible Chat Completions endpoints, Anthropic uses Messages, and OpenRouter uses Chat Completions with provider-qualified model IDs. An agent assignment references an enabled provider model and has a stable ordering within the agent.
- Keep the old organization key column temporarily deprecated. Existing ciphertext contains only Organization identity, so SQL cannot safely turn it into a provider-bound credential. An explicit **Import existing OpenAI key** action decrypts, creates the connection and model, assigns unconfigured agents, and clears the old key in one transaction. No reads migrate data.
- Until import, only agents with no model assignments can use the legacy key and existing default model. New onboarding and Settings stop writing that column. Assigned agents always use their selected connection. Document this compatibility window and remove the column in a later migration after existing installations have imported their keys.
- Extend Organization deletion to purge assignments, provider models, and providers in dependency order. Preserve applied migration history and generate a new checked-in migration.

## Implementation stack

| PR | Base | Scope and API anchors | Required evidence |
| --- | --- | --- | --- |
| 1. Provider storage and agent runtime | `main` | Plan, schema and migrations, `lib/model-providers`, `Agents` fields and assignment validation, chat adapter resolution, legacy import, Organization deletion. Existing UI callers remain valid while model assignments are introduced. | Migration generation and check. Durable service tests for duplicate vendor instances, key identity, scoped assignments, in-use removal, optimistic conflicts, and default-model runtime routing. Platform ready and binary smoke check. |
| 2. Anthropic and OpenRouter adapters | PR 1 | Native Anthropic adapter, three provider presets, provider protocol validation, and controlled transport regression tests. OpenAI custom endpoints retain Responses or Chat Completions support. | Verify independent instance credentials, Anthropic Messages, and OpenRouter Chat Completions through the actual adapters against controlled HTTP responses. Platform ready and binary smoke check. |
| 3. Models, agent configuration, and onboarding | PR 2 | `routes/_authenticated/$orgSlug/models`, sidebar, agent forms and loaders, onboarding redirects, dashboard guide, Settings key removal, and consumer documentation. Reuse safe service contracts and preserve blank-key edits. | Browser proof of two OpenAI connections, different URLs, enabled-model selection, provider-qualified agent choices, default selection, import and in-use protection. Provider-first onboarding journey and removal of the old Settings card. Current screenshots or recording attached to the PR. Platform ready and binary smoke check. |
| 4. Development provisioning and dogfood | PR 3 | Organization hooks, `scripts/seed`, dogfood regression coverage, setup docs, and removal of automatic legacy key writes. | Rerunnable seed proof and dogfood assignment coverage, including preservation of changed credentials and enabled models. Platform ready and binary smoke check. |

Each PR is based on the preceding branch and must remain reviewable on its own. Run the affected project's `ready` once before publishing each PR, diagnosing failures with focused checks. Compare source counts and built binary size against that PR's base. Apply migrations only to this worktree's isolated database for local verification. Keep screenshots, recordings, and logs outside the repository when publishing evidence.

## Boundaries

Direct Google support, OAuth, arbitrary authentication headers, dynamic adapter packages, automatic fallback, model pricing, and background discovery are deferred. OpenRouter routes its provider-qualified model IDs through its [OpenAI-compatible API](https://openrouter.ai/docs/quickstart). OpenCode is a design reference, not an initial provider. Custom endpoints are an explicit owner/developer configuration and may target private networks for self-hosted installations. Validate URL syntax and prohibit embedded URL credentials. Never accept endpoint or key overrides from a chat request.

Browser evidence proves the local product flows. Unit and integration tests can prove routing against controlled endpoints without charging real model accounts. Label those separately from any successful live vendor request, and do not claim hosted deployment verification.
