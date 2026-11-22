# Models

Connect a model provider so your agents can reply. Each organization manages its own credentials and billing.

New organizations start with an **OpenAI** connection that has GPT-6 Luna enabled and assigned to the starter agent, so chat works right away. To use your own OpenAI account, edit that connection and enter your key. To use another provider or a gateway, add a provider with an API key that can access the model you want.

## Add a provider

1. Open **Models** and choose **Add provider**.
2. Enter a name, select a provider, and enter its API key. Keep the default API URL unless you use a compatible gateway.
3. Enable the models you want. Use the catalog defaults where available.
4. Choose **Save provider**, then select a model under **Test model** and run the test. Wait for a successful reply. The request may incur provider charges.
5. Choose **Set up an agent**.

## Provider formats

| Provider | API format | Automatic compaction |
| --- | --- | --- |
| OpenAI | Responses by default, or Chat Completions for compatible gateways | Official Responses can use native compaction when the agent's **Web access** is off. Other OpenAI connections and configurations use a text summary. |
| Anthropic | Messages | The official endpoint can use native compaction on supported models, with a text summary as fallback. Custom endpoints use a text summary. |
| Google Gemini | Generate Content with a Google AI Studio key | Text summary |
| xAI Grok | Responses | Text summary |
| OpenRouter | Chat Completions | Text summary |

Leave the version path off Anthropic and Gemini API URLs. Their clients add it. The provider is fixed after saving. Create another connection to change it.

Keys are encrypted. Leave the key field blank to keep it, or enter a replacement to rotate it. Changing the API URL requires re-entering the key.

## Prices and token limits

Catalog prices refresh daily. Use **Override catalog defaults** for a custom model or different rates. Enter `0` explicitly for a free model. Turning overrides off discards your custom values.

Open **Models**, select the connection, and enable **Override catalog defaults** on the model to set its token limits.

- **Input maximum** caps input tokens.
- **Context window** includes input and output. Chat subtracts the **Output cap** from this value to determine how much space is available for input.
- **Model output maximum** is the provider model's output limit. Confirm this value with the provider before increasing it.
- **Output cap** is the generation limit the platform sends with each chat request. Keep it at or below the model output maximum.

Set at least one of **Input maximum** or **Context window**. When both are set, chat uses the smaller input allowance. Use [Usage limits](./usage-limits.md) to control token use or model spend over time.

## Automatic compaction

As a long chat approaches its model's input limit, the platform compacts older context and keeps recent messages available to the model. Every agent uses automatic compaction. The platform chooses when to compact and how much recent context to keep. If the provider's native compaction is unavailable, the platform uses a text summary.

People may see **Summarizing earlier messages…** while chat prepares the context. The full transcript, saved attachments, and tool results remain visible. The model may lose some details from earlier messages, so people can restate a detail when it matters. Compaction calls count toward the same usage limits as chat replies.

## Assign models to an agent

1. Open **Agents** and choose an existing agent or **Add agent**.
2. Select one or more **Models**. Each choice includes its provider name, so the same upstream model can appear through multiple connections.
3. Choose the **Default model**, then save the agent. New chat runs use that default through its provider's API URL and key.

Remove models from their agents before disabling them or deleting their provider. See [Agents](./agents.md) for other settings.

## Troubleshooting

- If a model request fails, check the provider's API URL, API format, key access, and exact model ID. Tenant users see only that the assistant is unavailable, so the provider's own error never reaches them.
- If saving refuses the API URL with `Use a public HTTPS API URL. This server does not allow HTTP or private network endpoints`, the deployment accepts only public HTTPS endpoints. A self-hosted deployment's operator can allow private endpoints in [Configuration](/docs/self-hosting/configuration#models).
- If the stored key cannot be read, enter it again in the provider editor and save.
- If an agent has no model choices, enable a model on a provider first.
