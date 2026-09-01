# Sandbox

An agent with a sandbox provider configured in the dashboard can write files, run commands, and publish results in one isolated Linux sandbox per conversation. Nothing is wired up in the SDK: the provider and instructions are owned by the organization.

## In the chat

- Each sandbox step is a transcript row: a file write expands to the file, a command to its output.
- While the sandbox provisions (tens of seconds), a slim status pill sits above the composer.
- Generated images (PNG, JPEG, GIF, WebP) the agent publishes render inline, with a download button.
- Any other published file appears as a download row; downloads are authorized by short-lived tickets.

## The sandbox panel

Off by default: the transcript already shows each step where it happened. `sandboxPanel: true` opts in.

```tsx
<AstralBeamChat sandboxPanel />
```

- A pill above the composer summarizes the sandbox ("3 files · 5 commands") and toggles the panel.
- The panel opens as an anchored sheet, so the composer never moves and a streaming reply stays readable.
- **Files** lists the latest content of every file the agent wrote, each viewable and downloadable.
- **Log** is the whole command history with exit codes and durations; failures read in red.

## Limits

- File and command output shown in the chat is clamped server-side for model context.
- Published artifacts are capped at 10 MB and served with content-sniffed types; see [Security model](./security.md).
- The sandbox is reused across turns of one conversation and expires after ~15 idle minutes; expired downloads say to ask the agent to regenerate.
