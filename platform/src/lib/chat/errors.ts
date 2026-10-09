import { Schema } from "effect"

// Errors with an `httpApiStatus` reach the tenant user's widget verbatim, so their messages are
// written for that reader.

export class ChatAuthenticationError extends Schema.TaggedError<ChatAuthenticationError>()(
  "ChatAuthenticationError",
  {},
  { httpApiStatus: 401 },
) {
  override readonly message = "The chat auth token is invalid."
}

export class ChatSystemPromptRefused extends Schema.TaggedError<ChatSystemPromptRefused>()(
  "ChatSystemPromptRefused",
  {},
  { httpApiStatus: 400 },
) {
  override readonly message = "The system prompt is agent configuration; set it in the dashboard."
}

export class ChatAgentNotFound extends Schema.TaggedError<ChatAgentNotFound>()(
  "ChatAgentNotFound",
  {},
  { httpApiStatus: 404 },
) {
  override readonly message = "Agent not found."
}

export class ChatDefaultAgentMissing extends Schema.TaggedError<ChatDefaultAgentMissing>()(
  "ChatDefaultAgentMissing",
  {},
  { httpApiStatus: 404 },
) {
  override readonly message =
    "This organization has no default agent; pass an agentId or set a default."
}

export class ChatModelMissing extends Schema.TaggedError<ChatModelMissing>()(
  "ChatModelMissing",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message =
    "This agent's model is not ready. Configure its model and pricing in Models."
}

/** The stored key failed to decrypt or belongs to another organization. */
export class ChatModelKeyUnreadable extends Schema.TaggedError<ChatModelKeyUnreadable>()(
  "ChatModelKeyUnreadable",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message = "The model provider key could not be read. Save it again in Models"
}

export class ChatAttachmentsDisabled extends Schema.TaggedError<ChatAttachmentsDisabled>()(
  "ChatAttachmentsDisabled",
  {},
  { httpApiStatus: 400 },
) {
  override readonly message = "This agent does not accept file attachments."
}
