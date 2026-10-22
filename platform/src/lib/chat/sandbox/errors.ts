import { Schema } from "effect"

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
