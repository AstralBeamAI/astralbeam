# Sandbox

Configure a sandbox provider on the agent in the dashboard to enable files, commands, and published results. Each conversation gets an isolated Linux sandbox, with no additional SDK wiring.

## In the chat

- Files the user attaches are written to `uploads/` in the sandbox, so the agent can analyze a spreadsheet with real code. See [Attachments](./attachments.md).
- Each sandbox step is a transcript row: a file write expands to the file, a command to its output.
- While the sandbox provisions (tens of seconds), a slim status pill sits above the composer.
- Generated images (PNG, JPEG, GIF, WebP) the agent publishes render inline, with a download button.
- Any other published file appears as a download row. Downloads are authorized by short-lived tickets.

## The sandbox panel

Off by default: the transcript already shows each step where it happened. `sandboxPanel: true` opts in.

```tsx
<AstralBeamChat sandboxPanel />
```

- A pill above the composer summarizes the sandbox ("3 files · 5 commands") and toggles the panel.
- The panel opens as an anchored sheet, so the composer never moves and a streaming reply stays readable.
- **Files** lists the latest content of every file the agent wrote, each viewable and downloadable.
- **Log** is the whole command history with exit codes and durations. Failures read in red.

## Limits

- File and command output shown in the chat is clamped server-side for model context.
- Published artifacts are capped at 10 MB and served with content-sniffed types. See [Security model](./security.md).
- The sandbox is reused across turns of one conversation and expires after ~15 idle minutes. Expired downloads say to ask the agent to regenerate.
