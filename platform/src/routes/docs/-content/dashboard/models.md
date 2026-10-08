# Models

Models connect your organization's agents to model providers. Let's add a provider, enable its models, and assign them to an agent.

## Add a provider

1. Open **Models** and choose **Add provider**.
2. Give the connection a unique **Name**, such as `OpenAI production`. You can add multiple OpenAI connections with different keys or API URLs.
3. Choose **OpenAI**, **Anthropic**, or **OpenRouter**, then set the **API URL**. OpenAI defaults to Responses and also offers Chat Completions for compatible gateways. Anthropic uses its Messages API. OpenRouter uses Chat Completions across its supported model providers. The provider is fixed once the connection is saved, so add another connection to use a different one.
4. Enter the provider's **API key**. It is encrypted when saved. Later, the editor shows only the last four characters. Leave the key field blank to keep the stored key, or enter a replacement to rotate it. Changing the API URL requires entering the key again, because a stored key never follows its connection to another endpoint.
5. Select the models to enable. All three providers offer catalog suggestions. For another model or private deployment, enter the exact **Custom model ID** and choose **Add model**. For OpenRouter, use the full model ID including its prefix, such as `anthropic/claude-sonnet-4.6`.
6. Review each model's catalog defaults. Keep **Override catalog defaults** off to receive automatic updates. Turn it on to edit prices and token limits for this connection. A model without catalog defaults requires an override before saving its settings. Enter zero explicitly for a free model. The catalog does not supply an output maximum, so review the initial 4,096-token ceiling against your provider's supported maximum.
7. Choose **Save provider**. Under **Test model**, select a saved model and choose **Test model** to check that it returns a reply. This sends a small request using your provider's key and may incur a charge. You can save a provider without enabling models and configure them later.
8. After the test succeeds, choose **Set up an agent**.

**NOTE**: Saving stores your configuration without making a model request. Catalog suggestions do not verify access, and your provider may restrict the models available to its key.

Test results apply to the selected model and saved configuration at that moment. Editing the configuration or choosing another model clears the result. Each organization can run up to five tests per minute, and each request stops after 30 seconds.

Catalog defaults refresh daily from Pydantic's genai-prices catalog. The editor shows the last successful refresh and warns when it is overdue. A failed refresh keeps the last valid defaults. Overrides belong to this model on this connection and do not change during catalog refreshes. Turning **Override catalog defaults** off discards your overrides and restores automatic updates to prices and token limits. Context pricing tiers apply to catalog prices, while overrides use the flat rates you enter. Expand **Cache pricing** to edit cache rates.

These settings record model prices and token limits. Set the output cap at or below the provider-supported output maximum. When your context window includes both input and output, the configured output cap reduces the displayed input allowance. Saving validates prices and token bounds. Runtime enforcement, usage accounting, and Tenant and tenant-user allowances are not active yet.

## Assign models to an agent

1. Open **Agents** and choose an existing agent or **Add agent**.
2. Select one or more **Models**. Each choice includes its provider name, so the same upstream model can appear through multiple connections.
3. Choose the **Default model**, then save the agent. New chat runs use that default through its provider's API URL and key.

The enabled provider models define what can be assigned to agents. Remove a model from its agents before disabling it on the provider or deleting the provider. Until you do, saving or deleting the provider fails with a message naming up to three of those agents. See [Agents](/docs/dashboard/agents) for the other agent settings.

## Troubleshooting

- If a model request fails, check the provider's API URL, API format, key access, and exact model ID. Tenant users see only that the assistant is unavailable, so the provider's own error never reaches them.
- If saving refuses the API URL with `Use a public HTTPS API URL. This server does not allow HTTP or private network endpoints`, the deployment accepts only public HTTPS endpoints. A self-hosted deployment's operator can allow private endpoints in [Configuration](/docs/self-hosting/configuration#model-providers).
- If the stored key cannot be read, enter it again in the provider editor and save.
- If an agent has no model choices, enable a model on a provider first.
- If a provider changed in another tab, reload its editor before saving again.
