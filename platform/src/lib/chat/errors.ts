import { Schema } from "effect"

export class ChatWebAccessUnavailable extends Schema.TaggedError<
  ChatWebAccessUnavailable,
  { readonly brand: unique symbol }
>()("ChatWebAccessUnavailable", {}, { httpApiStatus: 503 }) {
  override readonly message =
    "Web access requires a supported model using OpenAI Responses, Anthropic Messages, or OpenRouter Chat Completions. Check the model and provider web-tool permissions."
}

// Errors with an `httpApiStatus` reach the tenant user's widget verbatim, so their messages are
// written for that reader.

export class ChatAuthenticationError extends Schema.TaggedError<
  ChatAuthenticationError,
  { readonly brand: unique symbol }
>()("ChatAuthenticationError", {}, { httpApiStatus: 401 }) {
  override readonly message = "The chat auth token is invalid."
}

export class ChatSystemPromptRefused extends Schema.TaggedError<
  ChatSystemPromptRefused,
  { readonly brand: unique symbol }
>()("ChatSystemPromptRefused", {}, { httpApiStatus: 400 }) {
  override readonly message = "The system prompt is agent configuration; set it in the dashboard."
}

export class ChatAgentNotFound extends Schema.TaggedError<
  ChatAgentNotFound,
  { readonly brand: unique symbol }
>()("ChatAgentNotFound", {}, { httpApiStatus: 404 }) {
  override readonly message = "Agent not found."
}

export class ChatDefaultAgentMissing extends Schema.TaggedError<
  ChatDefaultAgentMissing,
  { readonly brand: unique symbol }
>()("ChatDefaultAgentMissing", {}, { httpApiStatus: 404 }) {
  override readonly message =
    "This organization has no default agent; pass an agentId or set a default."
}

export class ChatModelMissing extends Schema.TaggedError<
  ChatModelMissing,
  { readonly brand: unique symbol }
>()("ChatModelMissing", {}, { httpApiStatus: 503 }) {
  override readonly message =
    "This agent has no model configured. Add a provider and select a model in the dashboard"
}

/** The stored key failed to decrypt or belongs to another organization. */
export class ChatModelKeyUnreadable extends Schema.TaggedError<
  ChatModelKeyUnreadable,
  { readonly brand: unique symbol }
>()("ChatModelKeyUnreadable", {}, { httpApiStatus: 503 }) {
  override readonly message = "The model provider key could not be read. Save it again in Models"
}

export class ChatAttachmentsDisabled extends Schema.TaggedError<
  ChatAttachmentsDisabled,
  { readonly brand: unique symbol }
>()("ChatAttachmentsDisabled", {}, { httpApiStatus: 400 }) {
  override readonly message = "This agent does not accept file attachments."
}

export class ChatAttachmentSandboxRequired extends Schema.TaggedError<
  ChatAttachmentSandboxRequired,
  { readonly brand: unique symbol }
>()("ChatAttachmentSandboxRequired", {}, { httpApiStatus: 400 }) {
  override readonly message =
    "CSV, TSV, Office, Parquet, and SQLite attachments require an agent with a sandbox."
}
