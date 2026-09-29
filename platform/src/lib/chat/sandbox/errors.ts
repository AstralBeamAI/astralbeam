import { Schema } from "effect"

// A download answers with `ChatArtifactUnavailable`. The others reach the agent as tool failures.

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
