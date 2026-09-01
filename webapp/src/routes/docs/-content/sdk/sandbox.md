# Sandbox

An agent with a sandbox provider configured in the dashboard can write files and run commands in one isolated Linux sandbox per conversation, building on what it already wrote. Nothing is wired up in the SDK: the provider and instructions are owned by the organization.

## In the chat

- Each sandbox step is a transcript row: a file write expands to the file, a command to its output.
- A **Sandbox** tray above the composer collects every file and the whole command log.
- While the sandbox provisions (tens of seconds), the tray shows a starting indicator.
- A reset clears the tray along with the transcript; the panel is rebuilt from the conversation.

## Limits

- File and command output shown in the chat is clamped server-side for model context.
- The sandbox is reused across turns of one conversation and expires after idling.
