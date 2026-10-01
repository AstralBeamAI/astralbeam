# Models

Models connect your organization's agents to model providers. Let's add a provider, enable its models, and assign them to an agent.

## Add a provider

1. Open **Models** and choose **Add provider**.
2. Give the connection a unique **Name**, such as `OpenAI production`. You can add multiple OpenAI connections with different keys or API URLs.
3. Choose **OpenAI**, **Anthropic**, or **OpenRouter**, then set the **API URL**. OpenAI defaults to Responses and also offers Chat Completions for compatible gateways. Anthropic uses its Messages API. OpenRouter uses Chat Completions across its supported model providers.
4. Enter the provider's **API key**. It is encrypted when saved. Later, the editor shows only the last four characters. Leave the key field blank to keep the stored key, or enter a replacement to rotate it.
5. Select the models to enable. All three providers offer catalog suggestions. For another model or private deployment, enter the exact **Custom model ID** and choose **Add model**. For OpenRouter, use the full model ID including its prefix, such as `anthropic/claude-sonnet-4.6`.
6. Choose **Save provider**, then **Set up an agent**.

**NOTE**: Saving stores your configuration without making a model request. Catalog suggestions do not verify access, and your provider may restrict the models available to its key.

## Assign models to an agent

1. Open **Agents** and choose an existing agent or **Add agent**.
2. Select one or more **Models**. Each choice includes its provider name, so the same upstream model can appear through multiple connections.
3. Choose the **Default model**, then save the agent. New chat runs use that default through its provider's API URL and key.

The enabled provider models define what can be assigned to agents. Remove a model from its agents before disabling it on the provider or deleting the provider. See [Agents](/docs/dashboard/agents) for the other agent settings.

## Move an existing organization key

If the organization still has its earlier OpenAI key setting, **Models** offers **Import existing key**. Importing creates an `Imported OpenAI` provider with the previous chat model, assigns it to agents without models, and clears the old setting. Existing agent model selections stay unchanged.

## Troubleshooting

- If a model request fails, check the provider's API URL, API format, key access, and exact model ID.
- If the stored key cannot be read, enter it again in the provider editor and save.
- If an agent has no model choices, enable a model on a provider first.
- If a provider changed in another tab, reload its editor before saving again.
