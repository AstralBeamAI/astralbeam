# Configuration

Every option below is also a prop on `<AstralBeamChat>`. On the vanilla handle, `update(options)` applies any subset in place, keeping the transcript, the session, and live widget renders. Nothing is fixed at mount.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `threadId` | `"auto"` | Restore this tab's selection, use `"new"` for a fresh chat, or pass a saved thread UUID |
| `agentId` | organization's default agent | `agent_<orgId>_<id>`, copied from the dashboard |
| `apiUrl` | `https://astralbeam.ai/api` | Base URL of the AstralBeam API, the widget streams from `/v1/chat` |
| `fetchAstralBeamToken` | `{ url: "/api/astralbeam/token" }` | Your chat auth token endpoint as `{ url, ...RequestInit }`, or a minting function |
| `title` | `"AstralBeam"` | Name in the widget's header |
| `showHeader` | `true` | `false` hides the header with its chat history and new chat buttons |
| `onClose` | none | Adds an X button and fullscreen chat at widths up to 900px. The host hides or unmounts chat in this callback |
| `resizable` | `true` | Enables the resize edge and keyboard resizing |
| `initialWidth` | host's initial width | Width in pixels, or `"100%"` for available width, when no saved override exists |
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
- `apiUrl` is a base, not a route: the widget appends `/v1/chat` for the stream and its subroutes for the agent handshake and artifact downloads.
- `fetchAstralBeamToken` is the only chat auth token option. The request form's init reaches `fetch` as given. See [Authentication](./authentication.md).
- Transport options are read per request. Updating `apiUrl` clears the previous deployment's local session. An updated `fetchAstralBeamToken` applies to the next token request.
- Saved conversations retain their selected agent. Updating `agentId` applies to new threads.
- Every option accepts an explicit `undefined` and reads as unset, so a value you do not have yet needs no conditional prop under `exactOptionalPropertyTypes`.

## Chat width

Chat resizes horizontally and keeps filling its parent's height. Let's choose a starting width:

```tsx
<AstralBeamChat initialWidth={420} />
```

- Saved width or a user adjustment takes precedence over `initialWidth`. Without either, changing `initialWidth` updates the width in place.
- Without `initialWidth`, the fallback is the mount's initial width.
- Drag the resize edge, or focus it and press Left/Right to move it. Home selects the minimum, and End fills the available width.
- `initialWidth="100%"` uses available container width as the default. A saved width still takes precedence, including when this prop changes.
- `resizable={false}` hides the resize edge while retaining configured sizing. Resizing changes width only, and height continues to fill the parent.
- A smaller container temporarily clamps the rendered width without overwriting your preferred width. Growing it restores the space available to that preference.
- With `onClose`, chat still fills the mobile viewport at widths up to 900px. Mobile layout leaves your saved desktop width intact.

### Layout boundary

Because fixed-width wrappers prevent chat from growing, let your surrounding wrappers follow its width and let adjacent content shrink. Keep a definite parent height, with `min-height: 0` where needed in flex columns.

The mount's parent is the default width boundary. Nested sidebar wrappers often grow with the chat, so their width cannot describe the space available. Let's return the stable outer layout container through `resizeContainer`:

```tsx
<AstralBeamChat initialWidth={420} resizeContainer={() => layoutRef.current} />
```

Use a container whose content width is independent of chat's width. The SDK uses that width for `"100%"` and the resize limit. Omit `resizeContainer` when the mount's parent already provides it. Avoid fixed widths or fixed grid tracks around the chat that would clip it or leave unused space.

### Saved width

Widths you choose that differ from the default are stored in `localStorage` for this origin. They restore on mount, including after reload or in a new tab, separately from account-scoped conversations and drafts.

- Returning to the default width removes the saved override. Unchanged gestures and temporary container constraints do not write preferences.
- The SDK derives the storage key from the vanilla mount's stable element ID, or from `agentId` when no mount ID exists.
- React chats use `agentId` when supplied. React's component `key` does not identify a stored width.
- Without a mount ID or `agentId`, the fallback key is `astralbeam:chat-size:v1`. Placements using the same key share their preference.
- Existing tabs keep their current layout. Saving a size does not immediately resize another open tab.
- If storage is unavailable, resizing still works for the current mount. Nothing sensitive is stored with the layout preference.

## Chrome slots

Replace parts of the widget's own chrome with host-rendered content, styled by the host page. In React they are plain props. On the vanilla handle they are `slots` renderers.

```tsx
<AstralBeamChat
  header={<MyChatTitle />}
  onClose={() => setChatOpen(false)}
  empty={<MyWelcome />}
  composerActions={<MyVoiceButton />}
/>
```

- `header` replaces the title. `headerActions` adds controls after the chat history and new chat buttons. `showHeader={false}` still hides the whole row.
- `empty` replaces the empty-transcript state. `composerActions` adds controls next to send.
- Vanilla: `slots: { header: (container) => { ...; return cleanup } }`, updatable through `update`.

## Imperative control

The React component exposes a ref. The vanilla handle has the same methods.

```tsx
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

Conversations are saved automatically and start private. Your token endpoint supplies the identity, so you can reopen, rename, and continue saved history across devices.

- Disconnecting may interrupt generation. Saved input, accepted tool results, and the last saved partial response remain available.
- Reopening never repeats a business tool. An unconfirmed action needs an explicit response or closure before its turn can continue.
- `reset()` starts another conversation. Managers can delete conversations, including their saved messages and uploaded files. Deletion does not undo tool actions.
- Uploaded files remain available with their conversation. Generated sandbox files can expire independently.
- `threadId` defaults to `"auto"`, restoring this tab's selection after authentication. Fresh independent tabs start a new chat. Use `"new"` to bypass restoration or a UUID to open explicitly.

```tsx
<AstralBeamChat />                    // Restore this tab, or start new
<AstralBeamChat threadId="new" />      // Start fresh
<AstralBeamChat threadId={threadId} /> // Open a saved thread
```

Duplicating a tab or opening one through an opener can copy its initial session storage, including the pending draft before a conversation is saved. The tabs maintain independent selections afterwards.

## MCP server management

`AstralBeamMcpServers` provides the server list and **Add MCP server** form used by the dashboard. Let's supply the servers and our host's authorized create and remove callbacks:

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

The host loads `servers` as `{ id, endpointUrl, authKind }` records. Each callback must authorize its operation on the server and refresh that list after success. `onCreateServer` receives the endpoint and authentication configuration, and may return `{ errors: [{ field: "endpointUrl", message: "Enter a public HTTPS URL." }] }` for field feedback. Omit write callbacks for a read-only list. `oauthRedirectUri` displays the exact URI to register with an OAuth provider. The shared `theme` and `colorScheme` options apply here too.

Vanilla hosts use `mountAstralBeamMcpServers(element, options)` from `@astralbeam/sdk/client`, then call `update(options)` or `unmount()`. Unmount when identity or management scope changes, or change the React `key`, to clear pending form values. The component does not grant permissions or create a new management API. Currently, Organization admins manage server definitions and TenantUsers manage their own connections through chat's **MCP connections** panel.
