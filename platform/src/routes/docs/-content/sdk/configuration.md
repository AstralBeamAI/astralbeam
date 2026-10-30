# Configuration

Pass these options as props to `<AstralBeamChat>` or to a JavaScript mount. Call `chat.update(options)` to change them in place. Start with the [Quickstart](/docs/start/quickstart) if you have not connected authentication yet.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
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

## Main-panel and multiple chats

Chat already follows its host's width and fills its height. For a main-panel chat, give the parent a definite height and use the existing sizing options:

```tsx
<main style={{ height: "calc(100dvh - 56px)" }}>
  <AstralBeamChat id="onboarding-chat" defaultWidth="100%" resizable={false} />
</main>
```

Saved width overrides still take precedence, so use a dedicated mount `id` for this panel. Omit `onClose` for inline chat to avoid its mobile viewport takeover. The host decides whether to hide its usual sidebar on onboarding pages.

Each mount has its own foreground request, tools, and transcript. Local restoration and drafts use `placementKey ?? agentId ?? "default"`, within the verified account and API scope. Different agents are isolated automatically. For independent panes using the same agent, supply distinct, stable `placementKey` values. Changing the effective key selects its remembered conversation and draft, while an explicit `threadId` keeps that conversation selected. Use separate mount IDs for independent width preferences.

```tsx
<AstralBeamChat id="setup-chat" placementKey="setup" agentId={agentId} />
<AstralBeamChat id="help-chat" placementKey="help" agentId={agentId} />
```

JavaScript mounts and the headless core accept `placementKey` too. Keys do not grant access or filter history. Two mounts can open the same saved `threadId`, but replies do not stream between them. Refresh or reopen to load the other's saved changes.

**NOTE**: Earlier SDK versions used shared browser storage. Those local selections and unsent drafts are not automatically assigned to a session key. Saved server conversations remain available through history.

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

## Imperative control

Use a React ref for imperative actions. JavaScript mount handles expose the same methods.

```tsx
import { useRef } from "react"
import type { AstralBeamChatRef } from "@astralbeam/sdk/react"

const chatRef = useRef<AstralBeamChatRef>(null)
// After mounting <AstralBeamChat ref={chatRef} />:
chatRef.current?.reset() // starts another thread and preserves saved history
chatRef.current?.stop() // stops the in-flight generation
```

## Behavior notes

- Assistant replies render as Markdown. Raw HTML is escaped and executable link protocols are dropped.
- Turning attachments off hides selected files and prevents sending them. Ready files remain in that conversation's local draft and return when attachments are enabled again.
- Dropping a widget from `widgets` disposes any render of it still in the transcript.
- To defer the chat chunk, render the component only on first open. Hide with CSS afterwards, since unmounting stops the foreground response. History remains saved.
- The host controls sidebar visibility. Persist its boolean in `sessionStorage` to restore it after reload within the same tab.

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
