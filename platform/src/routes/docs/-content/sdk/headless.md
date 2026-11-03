# Headless

Build your own chat UI with the SDK's authentication, transport, tools, and transcript state. Set up the same [token endpoint](./authentication.md) used by the drop-in widget before connecting the session.

## Connect a session

<!-- ::start:tabs -->

### React

`useAstralBeamChat` returns a stable session and subscribes the component to its state updates. Read the current snapshot with `chat.getState()` and call actions directly on `chat`. Use it with the styled `<AstralBeamChat chat={chat} />` view, or supply your own message and composer components:

```tsx
import { useAstralBeamChat } from "@astralbeam/sdk/react"

function MyChat() {
  const chat = useAstralBeamChat({})
  const { messages, auth, status } = chat.getState()
  return (
    <div>
      {messages.map((message) => (
        <MyMessage key={message.id} message={message} />
      ))}
      <MyComposer
        disabled={auth.status !== "ready" || status !== "ready"}
        onSend={chat.sendMessage}
      />
    </div>
  )
}
```

- State from `chat.getState()`: `messages`, `status`, `error`, `auth`, `capabilities`, `sandbox`, `sandboxStatus`, `agentTools`, `history`, `submission`, and `usageLimitReached`, which names the [usage limit](/docs/dashboard/usage-limits) that refused or ended the last run and when it resets.
- Actions on `chat`: `sendMessage`, `retry`, `addToolResult`, `stop`, `reload`, `reset`. `reload` refreshes saved history and can deliver retained tool results, without resubmitting user input.
- Each send becomes the `submission`, whose `phase` moves from `submitting` to `accepted`, `failed`, or `refused`. `sendMessage` and `retry()` resolve with the attempt's outcome.
- Clear your composer when you send, and return the `content` of a `refused` outcome to it. A `failed` submission may have reached the server, so offer `retry()`.
- An attempt the session declines, such as one sent while another is active, resolves `refused` without replacing the active submission. `stop()` returns an unsent message the same way.
- `retry()` reuses the admission key. Within 24 hours, an accepted retry restores saved history without starting another response.
- Keep tool schemas outside render, or memoize schemas derived from props. Changing a schema invalidates pending execution. Tool callbacks can still read current props and state.
- Options follow the props you pass, including `agentId`, `apiUrl`, and `fetchAstralBeamToken`. Remount when the host identity changes, as described in [Authentication](./authentication.md#switching-workspaces).
- With your own components, there is no shadow root or bundled styling. See [shared sessions](./configuration.md#shared-session) for ownership and moving the styled view between layouts.

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
