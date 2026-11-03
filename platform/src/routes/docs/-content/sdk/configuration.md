# Configuration

Pass these options as props to `<AstralBeamChat>` or to a JavaScript mount. Call the JavaScript mount handle's `update(options)` to change them in place. Start with the [Quickstart](/docs/start/quickstart) if you have not connected authentication yet.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `chat` | none | An optional session returned by the React hook or vanilla factory. Omit to manage it internally. Configure authentication and tools on its owner, see [Shared session](#shared-session) |
| `threadId` | `"auto"` | Restore this tab's selection, use `"new"` for a fresh chat, or pass a saved thread UUID |
| `placementKey` | `agentId`, then `"default"` | Local namespace for the remembered conversation and drafts. Use distinct keys for independent chats with the same agent |
| `agentId` | organization's default agent | `agent_<orgId>_<id>`, copied from the dashboard |
| `apiUrl` | `https://astralbeam.ai/api` | Base URL of the AstralBeam API, the widget streams from `/v1/chat` |
| `fetchAstralBeamToken` | `{ url: "/api/astralbeam/token" }` | Endpoint as `{ url, ...RequestInit }`, or a callback retrieving a server-minted token |
| `title` | `"AstralBeam"` | Name in the widget's header |
| `showHeader` | `true` | `false` hides the title, history, and new-chat controls. MCP and close controls may remain |
| `onClose` | none | Adds an X button and fullscreen chat at widths up to 900px. The host hides or unmounts chat in this callback |
| `resizable` | `true` | Enables the resize edge and keyboard resizing |
| `defaultWidth` | host's initial width | Width in pixels, or `"100%"` for available width, when no saved override exists |
| `resizeContainer` | mount's parent | `() => HTMLElement \| null` returning the stable container that limits available width |
| `showConversationTitle` | `false` | Shows a bar under the header with a titled conversation's title and a menu to rename, delete, or copy it as Markdown |
| `emptyHeadline`, `emptyDescription` | generic copy | Headline and subtitle of the empty transcript |
| `colorScheme` | `"system"` | `"light"`, `"dark"`, or follow the OS setting live |
| `theme` | built-in palette | `{ light, dark }` CSS token overrides, see [Theming](./theming.md) |
| `customCss` | None | Trusted CSS inside the widget's Shadow DOM, updated without resetting chat |
| `attachments` | `true` | `false` disables, an object narrows limits. See [Attachments](./attachments.md) |
| `sandboxPanel` | `false` | Shows the collected sandbox panel, see [Sandbox](./sandbox.md) |
| `tools`, `widgets` | none | See [Tools and widgets](./tools-and-widgets.md) |
| `debug` | `false` | Log SDK actions in the browser, with server logs in development only |

- For self-hosting, set `apiUrl` to your deployment’s `/api` base. Send tokens only to the deployment that issued the API key.
- The SDK appends API paths to `apiUrl`. Updating it clears the previous deployment's local session.
- Token-source changes apply to the next acquisition. See [Authentication](./authentication.md) for endpoint and callback forms.
- Saved conversations retain their selected agent. Updating `agentId` switches the default local session. With an explicit `placementKey`, it keeps the selected conversation and applies to new threads.

## Chat width

Chat resizes horizontally and fills its parent's height. Give the parent a definite height and let surrounding wrappers follow chat's width.

- `defaultWidth` accepts pixels or `"100%"` for available width. Omit it to use the mount's initial CSS width. Saved overrides take precedence.
- The mount's parent limits available width. Supply `resizeContainer={() => layoutRef.current}` only when nested wrappers require a stable outer layout container.
- Drag the edge or use arrow keys, Home, and End to resize. `resizable={false}` hides the edge while preserving sizing and saved preferences.
- Only widths that differ from the default are saved in `localStorage` across reloads and new tabs. Returning to the default clears the override.
- Storage combines the mount element's `id` (React's `id` prop) and `agentId` when provided. Without either, chats share one width preference on the same origin.
- Narrow containers temporarily clamp your preferred width. With `onClose`, mobile chat fills the viewport while keeping the desktop preference. Existing tabs keep their current layout.

## Chrome slots

Replace header, welcome, or composer content with components styled by your application. React uses props. JavaScript mounts use `slots` renderers.

<!-- ::start:tabs variant="files" -->

```tsx title="React"
<AstralBeamChat
  header={<MyChatTitle />}
  onClose={() => setChatOpen(false)}
  empty={<MyWelcome />}
  composerActions={<MyVoiceButton />}
/>
```

```js title="JavaScript"
chat.update({
  slots: {
    header: (container) => {
      container.textContent = "Support"
    },
  },
})
```

<!-- ::end:tabs -->

- `header` replaces the title. `headerActions` adds controls after the chat history and new chat buttons. `showHeader={false}` hides these slots. MCP and an optional close control remain.
- `empty` replaces the empty-transcript state. `composerActions` adds controls next to send.
- JavaScript slot renderers receive a container and can return a cleanup function.

## Shared session

Most embeds use `<AstralBeamChat {...options} />`, which manages its session internally. Lift `useAstralBeamChat(options)` when application controls need to send messages, select history, reset chat, or move its view between layouts. Configure authentication and tools on the hook, with widgets and appearance on the view.

```tsx
import { AstralBeamChat, useAstralBeamChat } from "@astralbeam/sdk/react"

function Assistant() {
  const chat = useAstralBeamChat({ placementKey: "assistant" })
  return <AstralBeamChat chat={chat} />
}
```

From a user action, call `await chat.sendMessage("Help me finish setup")`. This sends its argument without reading or clearing the composer draft. Use `chat.retry()` for a `failed` outcome, whose delivery is uncertain, and let users edit or retry `refused` input. Avoid sending automatically from a mount Effect, since remounts can repeat the request.

Call `chat.reset()` to start another conversation and clear its new-conversation draft, or `chat.stop()` to stop generation. Saved history and saved-conversation drafts remain. Use `chat.openThread(id)` to select saved history.

Keep the hook above conditional layouts and mount one interactive view at a time. Detaching the view preserves the response and draft. Unmounting the owner stops the session. A drop-in `<AstralBeamChat {...options} />` owns its session and disposes it when removed.

Outside React, create `chat` with `createAstralBeamChat(options)` from `@astralbeam/sdk/core` and pass it to `mountAstralBeamChat(target, { chat, ...appearance })`. Use `chat.updateOptions()` for session changes and `handle.update()` for presentation. `handle.unmount()` detaches the view. `chat.dispose()` ends the session. Remount to change session ownership.

**NOTE**: This replaces `AstralBeamChatRef` and the mount handle's `reset()`/`stop()`. Use `chat` for actions and `chat.getState()` for state, replacing `.core` and snapshot fields. Directory handles are unchanged.

## Behavior notes

- Assistant replies render as Markdown. Raw HTML is escaped and executable link protocols are dropped.
- Turning attachments off hides selected files and prevents sending them. Ready files remain in that conversation's local draft and return when attachments are enabled again.
- Dropping a widget from `widgets` disposes any render of it still in the transcript.
- To defer the chat chunk, render the component only on first open. A supplied session can keep running without its view. Hide with CSS to preserve rendered host component state. History remains saved.
- The host controls sidebar visibility. Persist its boolean in `sessionStorage` to restore it after reload within the same tab.
- Changing `placementKey` selects that placement's remembered conversation and draft. An explicit `threadId` takes precedence. Placement keys do not restrict access to saved history.

## Saved conversations

Conversations save automatically and start private. Authenticated users can reopen, rename, and continue their history across devices.

- Disconnecting may interrupt generation. Saved input, accepted tool results, and the last saved partial response remain available.
- Reopening never repeats a business tool. An unconfirmed action needs an explicit response or closure before its turn can continue.
- `reset()` starts another conversation. Managers can delete conversations, including their saved messages and uploaded files. Deletion does not undo tool actions.
- Uploaded files and published sandbox artifacts remain available with their conversation. Temporary sandbox files can disappear when the workspace shuts down.
- `threadId` defaults to `"auto"`, restoring this tab's selection after authentication. Fresh independent tabs start a new chat. Use `"new"` to bypass restoration or a UUID to open explicitly.

```tsx
<AstralBeamChat />                    // Restore this tab, or start new
<AstralBeamChat threadId="new" />      // Start fresh
<AstralBeamChat threadId={threadId} /> // Open a saved thread
```

Duplicating a tab or opening one through an opener can copy its initial session storage, including the pending draft before a conversation is saved. The tabs maintain independent selections afterwards.

**NOTE**: Existing shared browser selections and unsent drafts are not migrated to placement keys. Saved server conversations remain available through history.

## MCP server management

`AstralBeamMcpServers` provides a server list and **Add MCP server** form. Supply the records and authorized management callbacks from your application:

```tsx
import { AstralBeamMcpServers } from "@astralbeam/sdk/react"

;<AstralBeamMcpServers
  key={`${currentUserId}:${managementScopeId}`}
  servers={servers}
  oauthRedirectUri={oauthRedirectUri}
  onCreateServer={createServer}
  onRemoveServer={removeServer}
/>
```

Load `servers` as `{ id, endpointUrl, authKind }` records. Callbacks must authorize the operation on your backend and refresh the list after success. Omit write callbacks for a read-only list.

`onCreateServer` receives the endpoint and authentication configuration. Return `{ errors: [{ field: "endpointUrl", message: "Enter a public HTTPS URL." }] }` for field feedback. `oauthRedirectUri` displays the provider callback URI. The component accepts the shared `theme` and `colorScheme` options.

Vanilla hosts use `mountAstralBeamMcpServers(element, options)` from `@astralbeam/sdk/client`, then call `update(options)` or `unmount()`. Unmount when identity or management scope changes, or change the React `key`, to clear pending form values. The component does not grant permissions or create a new management API. Currently, Organization admins manage server definitions and TenantUsers manage their own connections through chat's **MCP connections** panel.
