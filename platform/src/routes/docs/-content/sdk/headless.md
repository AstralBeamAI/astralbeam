# Headless

The drop-in widget is one consumer of a headless core: authentication, transport, the tool protocol, and transcript state with no markup. Own your whole chat UI by consuming the core directly.

## React

`useAstralBeamChat` returns the live session state plus its actions. Every rerender reflects the stream.

```tsx
import { useAstralBeamChat } from "@astralbeam/sdk/react"

function MyChat() {
  const chat = useAstralBeamChat({ tools, widgets, onRenderWidget })
  return (
    <div>
      {chat.messages.map((message) => (
        <MyMessage key={message.id} message={message} />
      ))}
      <MyComposer
        disabled={chat.auth.status !== "ready" || chat.status !== "ready"}
        onSend={(text) => void chat.sendMessage(text)}
      />
    </div>
  )
}
```

- State: `messages`, `status`, `error`, `auth`, `capabilities`, `sandbox`, `sandboxStatus`, `agentTools`.
- Actions: `sendMessage`, `addToolResult`, `stop`, `reload`, `reset`. `reload` refreshes saved history and can deliver retained tool results, without resubmitting user input.
- Retrying an unchanged unsent draft reuses its admission key. Within 24 hours, an accepted retry restores saved history without starting another response.
- Options follow the props you pass, including `agentId`, `apiUrl`, and `fetchAstralBeamToken`. Nothing needs a remount.
- No shadow root and no bundled styles: your markup, your CSS.

## Any framework

`createAstralBeamChat` from `@astralbeam/sdk/core` is the same session with `subscribe`/`getState`.

```ts
import { createAstralBeamChat } from "@astralbeam/sdk/core"

const chat = createAstralBeamChat({ agentId, tools })
const unsubscribe = chat.subscribe(() => render(chat.getState()))
await chat.sendMessage("What can you do?")
chat.dispose()
```

- Widgets declare `{ description, parameters }`. The session validates props and calls `onRenderWidget`, which draws the widget and may return cleanup.
- `agentTools` lists the tools declared to the agent with their titles, and `retryAuthentication()` re-mints a rejected token.
- Call the request's `release()` if you dispose a render yourself (an eviction cap of your own), so the session stops holding its cleanup.
- `chat.updateOptions({ agentId })` applies the agent to new conversations. The current saved conversation retains its agent and transcript.
- Unresolved tool outcomes require an explicit response or closure before their turn continues.
- `capabilities` reflects the agent's dashboard policy. Render only what it grants.

## Reading the transcript

The core exports the part helpers the widget itself renders with.

- `isSandboxTool`, `readSandboxFileWrite`, `readSandboxCommandRun`, `readSandboxArtifact`, `collectSandboxActivity`.
- `isSettledToolCall`, `lastPartInProgress`, `hasPendingToolRun` for busy states.
- Protocol names (`RENDER_WIDGET_TOOL`, `ASK_QUESTIONNAIRE_TOOL`, sandbox tool names) for custom renderers.

## Saved conversation controls

New conversations start private. Let's load the saved conversations the current user can access.

```ts
const chat = createAstralBeamChat({ tools })
const page = await chat.searchThreads()
const threadId = page.items[0]?.id
if (!threadId) throw new Error("No saved conversations yet.")
await chat.openThread(threadId)
await chat.sendMessage("Continue from here")
```

- `searchThreads(query?, cursor?, signal?)` returns a page of conversations. Read `thread` and `threadLoading` from session state. Wait for hydration before enabling your composer.
- Use `reset()` for a fresh conversation. Managers can rename and delete saved threads with `renameThread(title)` and `deleteThread()`.
- Keep tool responses associated with their stored call and target across browser clients.
- You can reopen saved state from another client. Live event replay, background recovery, branching controls, and tool fan-out are not available yet.
