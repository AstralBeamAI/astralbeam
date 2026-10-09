import { Schema } from "effect"

export class ModelPriceCatalogUnavailable extends Schema.TaggedError<ModelPriceCatalogUnavailable>()(
  "ModelPriceCatalogUnavailable",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message = "Model prices are updating. Try again shortly."
}

export class ModelProviderChanged extends Schema.TaggedError<ModelProviderChanged>()(
  "ModelProviderChanged",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "This provider changed since you opened it. Reload and try again"
}
export class ModelProviderNameTaken extends Schema.TaggedError<ModelProviderNameTaken>()(
  "ModelProviderNameTaken",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "A model provider with this name already exists"
}
const modelAssignmentAgentList = new Intl.ListFormat("en", { type: "conjunction" })

function describeModelAssignmentAgents(names: readonly string[] = [], count = names.length) {
  if (names.length === 0) return "their agents"
  const rest = count - names.length
  return `${count === 1 ? "the agent" : "the agents"} ${modelAssignmentAgentList.format(
    rest > 0 ? [...names, `${rest} more`] : names,
  )}`
}

/** Names up to three blocking agents and counts the rest. */
export class ModelProviderInUse extends Schema.TaggedError<ModelProviderInUse>()(
  "ModelProviderInUse",
  {
    agentNames: Schema.optionalKey(Schema.Array(Schema.String)),
    agentCount: Schema.optionalKey(Schema.Number),
  },
  { httpApiStatus: 409 },
) {
  override readonly message = `Remove these models from ${describeModelAssignmentAgents(
    this.agentNames,
    this.agentCount,
  )} before disabling them or deleting the provider`
}
export class ModelProviderEndpointNotAllowed extends Schema.TaggedError<ModelProviderEndpointNotAllowed>()(
  "ModelProviderEndpointNotAllowed",
  {},
  { httpApiStatus: 422 },
) {
  override readonly message =
    "Use a public HTTPS API URL. This server does not allow HTTP or private network endpoints"
}
export class ModelProviderUnreadable extends Schema.TaggedError<ModelProviderUnreadable>()(
  "ModelProviderUnreadable",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message =
    "The model provider key could not be read. Save the key again in Models"
}
export class ModelProviderKeyMissing extends Schema.TaggedError<ModelProviderKeyMissing>()(
  "ModelProviderKeyMissing",
  {},
  { httpApiStatus: 422 },
) {
  override readonly message = "Enter an API key for this provider"
}

export class ModelUsageConfigurationMissing extends Schema.TaggedError<ModelUsageConfigurationMissing>()(
  "ModelUsageConfigurationMissing",
  {},
  { httpApiStatus: 422 },
) {
  override readonly message =
    "Configure USD prices and input/output token limits for every enabled model"
}

export class ModelProviderTestFailed extends Schema.TaggedError<ModelProviderTestFailed>()(
  "ModelProviderTestFailed",
  {
    reason: Schema.Literals([
      "credentials",
      "model",
      "configuration",
      "network",
      "allowance",
      "timeout",
      "empty",
    ]),
  },
  { httpApiStatus: 422 },
) {
  override readonly message = {
    credentials:
      "The provider refused access. Check your key's permissions, or enter a replacement API key and save the provider.",
    model: "The model is unavailable. Check its model ID and whether your key can access it.",
    configuration:
      "The provider rejected the request. Check the API format, API URL, and model ID.",
    network:
      "The provider could not be reached or returned a server error. Check the API URL and try again.",
    allowance:
      "The provider limited the request. Check your quota, billing, and rate limits before retrying.",
    timeout: "The model did not finish within 30 seconds. Try again or choose another model.",
    empty: "The model did not return a completed text reply. Try again or choose another model.",
  }[this.reason]
}

export class ModelProviderTestRateLimited extends Schema.TaggedError<ModelProviderTestRateLimited>()(
  "ModelProviderTestRateLimited",
  {},
  { httpApiStatus: 429 },
) {
  override readonly message =
    "This organization has reached five model tests per minute. Wait a minute and try again."
}
