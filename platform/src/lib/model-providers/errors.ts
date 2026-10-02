import { Schema } from "effect"

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
