# Headless

The drop-in widget is one consumer of a headless core: authentication, transport, the tool protocol, and transcript state with no markup. Own your whole chat UI by consuming the core directly.

## React

`useAstralBeamChat` returns the live session state plus its actions; every rerender reflects the stream.

```tsx
import { useAstralBeamChat } from "@astralbeam/sdk/react"

function MyChat() {
  const chat = useAstralBeamChat({ tools, widgets, onRenderWidget })
  return (
    <div>
      {chat.messages.map((message) => <MyMessage key={message.id} message={message} />)}
      <MyComposer
        disabled={chat.auth.status !== "ready" || chat.status !== "ready"}
        onSend={(text) => void chat.sendMessage(text)}
      />
    </div>
  )
}
```

- State: `messages`, `status`, `error`, `auth`, `capabilities`, `sandbox`, `sandboxStatus`.
- Actions: `sendMessage`, `addToolResult`, `stop`, `reload`, `reset`; `core` exposes the raw session.
- Options are fixed for the component's lifetime; remount with a React `key` to change them.
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

- `widgets` declares what the agent may draw; your `onRenderWidget` draws it and may return a cleanup.
- Sending settles dangling tool calls first (questionnaires as skipped), the same as the widget.
- `capabilities` reflects the agent's dashboard policy; render only what it grants.

## Reading the transcript

The core exports the part helpers the widget itself renders with.

- `isSandboxTool`, `readSandboxFileWrite`, `readSandboxCommandRun`, `readSandboxArtifact`, `collectSandboxActivity`.
- `isSettledToolCall`, `lastPartInProgress`, `hasPendingToolRun` for busy states.
- Protocol names (`RENDER_WIDGET_TOOL`, `ASK_QUESTIONNAIRE_TOOL`, sandbox tool names) for custom renderers.
