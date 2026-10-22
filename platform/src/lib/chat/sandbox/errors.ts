import { Schema } from "effect"

/** Replaces the vendor's own error, which can carry hostnames or credentials, before it escapes. */
export class ChatSandboxUnavailable extends Schema.TaggedError<ChatSandboxUnavailable>()(
  "ChatSandboxUnavailable",
  {},
) {
  override readonly message = "The sandbox could not be started"
}

/** The agent's provider configuration is gone or unreadable, so the run goes without a sandbox. */
export class ChatSandboxConfigurationUnreadable extends Schema.TaggedError<ChatSandboxConfigurationUnreadable>()(
  "ChatSandboxConfigurationUnreadable",
  {},
) {}
