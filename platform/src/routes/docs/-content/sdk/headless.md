# Headless

Build your own chat UI with the SDK's authentication, transport, tools, and transcript state. Set up the same [token endpoint](./authentication.md) used by the drop-in widget before connecting the session.

## Connect a session

<!-- ::start:tabs -->

### React

`useAstralBeamChat` returns live state and session actions. Your application supplies the message and composer components:

```tsx
import { useAstralBeamChat } from "@astralbeam/sdk/react"

function MyChat() {
  const chat = useAstralBeamChat({})
  return (
    <div>
      {chat.messages.map((message) => (
        <MyMessage key={message.id} message={message} />
      ))}
      <MyComposer
        disabled={chat.auth.status !== "ready" || chat.status !== "ready"}
        onSend={chat.sendMessage}
      />
    </div>
  )
}
```

- State: `messages`, `status`, `error`, `auth`, `capabilities`, `sandbox`, `sandboxStatus`, `agentTools`, `history`, `submission`, and `usageLimitReached`, which names the [usage limit](/docs/dashboard/usage-limits) that refused or ended the last run and when it resets.
- Actions: `sendMessage`, `retry`, `addToolResult`, `stop`, `reload`, `reset`. `reload` refreshes saved history and can deliver retained tool results, without resubmitting user input.
- Each dispatched send becomes the `submission`, whose `phase` moves from `submitting` to `accepted`, `failed`, or `refused`. `sendMessage` and `retry()` resolve with the attempt's outcome.
- Clear your composer when you send, and return the `content` of a `refused` outcome to it. A `failed` submission may have reached the server, so offer `retry()`.
- While processing, `sendMessage` retains input locally and resolves `queued` without replacing the active submission. `onQueued` acknowledges local retention and `onAccepted` acknowledges the server. Follow-ups run individually after the active turn and its browser tools finish.
- Pass a third argument, `{ whenBusy: "steer" }`, to guide the active turn before its next model request. Completed output and tool effects remain. A completed target falls back to a queued follow-up.
- Read `pendingMessages` and `queuePaused`, and use `editPendingMessage`, `removePendingMessage`, `steerPendingMessage`, and `resumeQueue` for controls. Stop, errors, conversation changes, and reload pause automatic delivery. Restored files require explicit reattachment. File references can be recovered, but file bytes are never stored with the queue.
- Other declined attempts resolve `refused` with their content. `stop()` returns input that was never dispatched the same way.
- `retry()` reuses the admission key. Within 24 hours, an accepted retry restores saved history without starting another response.
- Options follow the props you pass, including `agentId`, `apiUrl`, and `fetchAstralBeamToken`. Remount when the host identity changes, as described in [Authentication](./authentication.md#switching-workspaces).
- No shadow root and no bundled styles: your markup, your CSS.

### JavaScript

Use `createAstralBeamChat` with `subscribe` and `getState` outside React:

```ts
import { createAstralBeamChat } from "@astralbeam/sdk/core"

const chat = createAstralBeamChat({})
const unsubscribe = chat.subscribe(() => render(chat.getState()))
await chat.sendMessage("What can you do?")
// Keep the session alive for the reply. On teardown, call unsubscribe() and chat.dispose().
```

- Widgets declare `{ description, parameters }`. Standard Schema parameters validate props before `onRenderWidget` draws the widget and optionally returns cleanup. Plain JSON Schema does not provide browser validation.
- `agentTools` lists the tools declared to the agent with their titles, and `retryAuthentication()` requests a fresh token after rejection.
- If your renderer disposes a widget early, call its request's `release()` to release the session cleanup.
- `chat.updateOptions({ agentId })` applies the agent to new conversations. The current saved conversation retains its agent and transcript.
- Unresolved tool outcomes require an explicit response or closure before their turn continues.
- `capabilities` reflects the agent's dashboard policy. Render only what it grants.

<!-- ::end:tabs -->

## Reading the transcript

Treat `messages`, parts, and metadata as immutable snapshots. Use session actions to change the conversation and `map`, `filter`, or `toSorted` to derive display values.

Import transcript helpers from `@astralbeam/sdk/core`:

- `isSandboxTool`, `readSandboxFileWrite`, `readSandboxCommandRun`, `readSandboxArtifact`, `collectSandboxActivity`.
- `isSettledToolCall`, `lastPartInProgress`, `hasPendingToolRun` for busy states.
- Protocol names (`RENDER_WIDGET_TOOL`, `ASK_QUESTIONNAIRE_TOOL`, sandbox tool names) for custom renderers.

## Saved conversation controls

Let's open a saved conversation the current user can access:

```ts
const chat = createAstralBeamChat({ tools })
const page = await chat.searchThreads()
const threadId = page.items[0]?.id
if (!threadId) throw new Error("No saved conversations yet.")
await chat.openThread(threadId)
await chat.sendMessage("Continue from here")
```

- `searchThreads(query?, cursor?, signal?)` returns a page of conversations. Read `thread` and `history` from session state. Show loading only while `history` is `loading`, which means nothing is shown yet. A send during `refreshing` waits for it.
- Use `reset()` for a fresh conversation. Managers can rename the selected thread with `renameThread(title)` and delete any listed thread with `deleteThread(thread)`.
- Keep tool responses associated with their stored call and target across browser clients.
- You can reopen saved state from another client. Live event replay, background recovery, branching controls, and tool fan-out are not available yet.
