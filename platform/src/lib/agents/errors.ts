import { Schema } from "effect"

// Each message is written for the member who sees it, so handlers may expose it verbatim.

export class AgentNotFound extends Schema.TaggedError<
  AgentNotFound,
  { readonly brand: unique symbol }
>()("AgentNotFound", {}, { httpApiStatus: 404 }) {
  override readonly message = "Select an agent from this organization"
}

export class AgentNameTaken extends Schema.TaggedError<
  AgentNameTaken,
  { readonly brand: unique symbol }
>()("AgentNameTaken", {}, { httpApiStatus: 409 }) {
  override readonly message = "An agent with this name already exists"
}

export class AgentSandboxProviderInvalid extends Schema.TaggedError<
  AgentSandboxProviderInvalid,
  { readonly brand: unique symbol }
>()("AgentSandboxProviderInvalid", {}, { httpApiStatus: 422 }) {
  override readonly message = "Select a sandbox provider from this organization"
}

/** The agent's lock version moved on, or the agent no longer exists. */
export class AgentChanged extends Schema.TaggedError<
  AgentChanged,
  { readonly brand: unique symbol }
>()("AgentChanged", {}, { httpApiStatus: 409 }) {
  override readonly message = "This agent changed since you opened it. Reload and try again"
}

export class AgentModelInvalid extends Schema.TaggedError<
  AgentModelInvalid,
  { readonly brand: unique symbol }
>()("AgentModelInvalid", {}, { httpApiStatus: 422 }) {
  override readonly message = "Select enabled models from this organization"
}
