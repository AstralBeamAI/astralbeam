# Models

Connect a model provider, test a model, then assign it to an agent. Each organization manages its own provider credentials and billing.

## Add a provider

1. Open **Models** and choose **Add provider**.
2. Enter a name, select a provider, and enter its API key. Keep the default API URL unless you use a compatible gateway.
3. Enable the models you want. Keep **Override catalog defaults** off unless you need custom values or the model has no catalog entry.
4. Choose **Save provider**, then select a model under **Test model** and run the test. Wait for a successful reply. The request may incur provider charges.
5. Choose **Set up an agent**.

**NOTE**: Saving alone does not verify model access. Tests use the saved configuration, are limited to five per minute per organization, and stop after 30 seconds.

## Provider formats

| Provider      | API format                                                        |
| ------------- | ----------------------------------------------------------------- |
| OpenAI        | Responses by default, or Chat Completions for compatible gateways |
| Anthropic     | Messages                                                          |
| Google Gemini | Gemini API with a Google AI Studio key                            |
| xAI Grok      | Responses                                                         |
| OpenRouter    | Chat Completions                                                  |

Leave the version path off Anthropic and Gemini API URLs. Their clients add it. The provider is fixed after saving. Create another connection to change it.

Keys are encrypted. The editor shows only the last four characters. Leave the key blank to retain it, or enter a replacement to rotate it. Changing the API URL requires re-entering the key so a stored credential never follows a connection to a different endpoint.

## Prices and token limits

Enter zero explicitly for a free model. The catalog supplies no output maximum, so check the initial 4,096-token ceiling against your provider's supported maximum.

Catalog defaults refresh daily. Manual prices belong to this model connection and survive refreshes. Token limits continue following the catalog unless you edit them. Turning **Override catalog defaults** off discards them. Catalog prices use context tiers, while overrides use flat rates. Expand **Cache pricing** to edit cache rates.

Price changes take effect when you save. Under **Price schedule**, choose **Schedule price change**, enter its future **Effective from** time in your local time zone, set its prices, then choose **Save provider**. Expand a future entry to edit it, or choose **Cancel scheduled price** and save to remove it. Turning off overrides also cancels scheduled prices. Active versions remain immutable, and the next model request uses the rates effective at its start, including requests within an ongoing conversation. Token limits are separate and are not scheduled.

Each model request saves its resolved rates before dispatch. A catalog refresh or later manual edit cannot change that snapshot. Existing manual prices begin their history when this feature's migration runs, without inventing prices for earlier dates. Received provider charges take precedence over token calculations. Recovery of partial usage after interruption remains separate work.

These settings record prices and token bounds. When the context window includes both input and output, the configured output cap reduces the displayed input allowance. Saving validates those bounds, but chat does not yet enforce the configured input allowance or output cap. Reported model usage and prices do feed saved conversation costs and [Usage limits](./usage-limits.md).

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
