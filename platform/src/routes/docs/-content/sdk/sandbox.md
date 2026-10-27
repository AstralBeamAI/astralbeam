# Sandbox

Give an agent a [tested sandbox provider](/docs/dashboard/sandboxes#add-and-verify-a-provider) to run commands and publish files. No SDK integration changes are required. Each workspace is scoped to the agent, conversation, and tenant user.

Ask **"Create a small CSV and give me a download."** Check the command exit code and download the published result.

## In the chat

- Files the user attaches are written to `uploads/` in the sandbox, so the agent can analyze a spreadsheet with real code. See [Attachments](./attachments.md).
- Text file reads support pages of up to 2,000 lines. The agent can request the next page without loading the whole file into model context.
- Each sandbox step is a transcript row: a file write expands to the file, a command to its output.
- Generated images (PNG, JPEG, GIF, WebP) the agent publishes render inline, with a download button.
- Any other published file appears as a download row. Downloads use your token and current conversation permissions. Published files survive sandbox shutdown.

## The sandbox panel

The transcript shows sandbox steps by default. Enable the optional panel to collect files and command history in one place:

```tsx
<AstralBeamChat sandboxPanel />
```

- A pill above the composer summarizes the sandbox ("3 files · 5 commands") and toggles the panel.
- **Files** shows the latest write for each path in the loaded transcript, with downloads of that recorded content. Long writes may be truncated. Publish an artifact to retain the complete file.
- **Log** shows commands from the loaded transcript with exit codes and durations. Failures read in red.

## Limits

- File and command output shown in the chat is clamped server-side for model context.
- Published artifacts are capped at 10 MiB and served with content-sniffed types. See [Security model](./security.md).
- Workspaces can disappear after idle cleanup, eviction, restart, or routing to another replica. Published files remain available through the saved conversation.
