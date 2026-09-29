import { Schema } from "effect"

// Errors with an `httpApiStatus` reach the tenant user's widget verbatim, so their messages are
// written for that reader. The sandbox errors reach the agent as tool failures instead.

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

export class ChatModelKeyMissing extends Schema.TaggedError<ChatModelKeyMissing>()(
  "ChatModelKeyMissing",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message = "Org OpenAI key is not configured"
}

/** The stored key failed to decrypt or belongs to another organization. */
export class ChatModelKeyUnreadable extends Schema.TaggedError<ChatModelKeyUnreadable>()(
  "ChatModelKeyUnreadable",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message = "Org OpenAI key could not be read; save it again in the dashboard"
}

export class ChatAttachmentsDisabled extends Schema.TaggedError<ChatAttachmentsDisabled>()(
  "ChatAttachmentsDisabled",
  {},
  { httpApiStatus: 400 },
) {
  override readonly message = "This agent does not accept file attachments."
}

const CHAT_ARTIFACT_UNAVAILABLE_MESSAGES = {
  Expired: "The download has expired. Ask the agent to publish the file again.",
  SandboxGone: "The sandbox is gone; ask the agent to regenerate the file.",
  Moved: "The file is no longer available.",
  TooLarge: "The file has grown past the artifact size limit.",
  Changed: "The file changed since it was published.",
} as const

/** A download ticket that no longer leads to the exact bytes it was minted for. */
export class ChatArtifactUnavailable extends Schema.TaggedError<ChatArtifactUnavailable>()(
  "ChatArtifactUnavailable",
  { reason: Schema.Literals(["Expired", "SandboxGone", "Moved", "TooLarge", "Changed"]) },
  { httpApiStatus: 404 },
) {
  override readonly message: string = CHAT_ARTIFACT_UNAVAILABLE_MESSAGES[this.reason]
}

/** Replaces the vendor's own error, which can carry hostnames or credentials, before it escapes. */
export class ChatSandboxUnavailable extends Schema.TaggedError<ChatSandboxUnavailable>()(
  "ChatSandboxUnavailable",
  {},
) {
  override readonly message = "The sandbox could not be started"
}

/** A vendor sandbox call that failed or timed out. The cause stays server-side for diagnostics. */
export class ChatSandboxOperationFailed extends Schema.TaggedError<ChatSandboxOperationFailed>()(
  "ChatSandboxOperationFailed",
  { timedOut: Schema.Boolean, cause: Schema.Unknown },
) {
  override readonly message: string = this.timedOut
    ? "The sandbox did not respond in time"
    : "The sandbox operation failed"
}

/** The agent's provider configuration is gone or unreadable, so the run goes without a sandbox. */
export class ChatSandboxConfigurationUnreadable extends Schema.TaggedError<ChatSandboxConfigurationUnreadable>()(
  "ChatSandboxConfigurationUnreadable",
  {},
) {}

/** Thrown from fflate's filter, which can stop an unpack only by throwing. */
export class ChatOfficeArchiveTooLarge extends Schema.TaggedError<ChatOfficeArchiveTooLarge>()(
  "ChatOfficeArchiveTooLarge",
  {},
) {}
