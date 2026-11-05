# Models

Connect a model provider so your agents can reply. You'll need a provider API key with access to the model you want to use. Each organization manages its own credentials and billing.

## Add a provider

1. Open **Models** and choose **Add provider**.
2. Enter a name, select a provider, and enter its API key. Keep the default API URL unless you use a compatible gateway.
3. Enable the models you want. Use the catalog defaults where available.
4. Choose **Save provider**, then select a model under **Test model** and run the test. Wait for a successful reply. The request may incur provider charges.
5. Choose **Set up an agent**.

**NOTE**: Saving does not verify model access. Run the test before assigning the model to an agent.

## Provider formats

| Provider      | API format                                                        |
| ------------- | ----------------------------------------------------------------- |
| OpenAI        | Responses by default, or Chat Completions for compatible gateways |
| Anthropic     | Messages                                                          |
| Google Gemini | Gemini API with a Google AI Studio key                            |
| xAI Grok      | Responses                                                         |
| OpenRouter    | Chat Completions                                                  |

Leave the version path off Anthropic and Gemini API URLs. Their clients add it. The provider is fixed after saving. Create another connection to change it.

Keys are encrypted. Leave the key field blank to keep it, or enter a replacement to rotate it. Changing the API URL requires re-entering the key.

## Prices and token limits

Catalog prices refresh daily. Use **Override catalog defaults** for a custom model or different rates. Enter `0` explicitly for a free model. Turning overrides off discards your custom values.

Verify the initial 4,096-token output maximum with your provider. Configured token bounds describe the model, but chat does not currently enforce them as request caps. To control token use or model spend, configure [Usage limits](./usage-limits.md). Spend limits depend on having a price for each model.

## Assign models to an agent

1. Open **Agents** and choose an existing agent or **Add agent**.
2. Select one or more **Models**. Each choice includes its provider name, so the same upstream model can appear through multiple connections.
3. Choose the **Default model**, then save the agent. New chat runs use that default through its provider's API URL and key.

Remove models from their agents before disabling them or deleting their provider. See [Agents](./agents.md) for other settings.

## Troubleshooting

- If a model request fails, check the provider's API URL, API format, key access, and exact model ID. Tenant users see only that the assistant is unavailable, so the provider's own error never reaches them.
- If saving refuses the API URL with `Use a public HTTPS API URL. This server does not allow HTTP or private network endpoints`, the deployment accepts only public HTTPS endpoints. A self-hosted deployment's operator can allow private endpoints in [Configuration](/docs/self-hosting/configuration#model-providers).
- If the stored key cannot be read, enter it again in the provider editor and save.
- If an agent has no model choices, enable a model on a provider first.
