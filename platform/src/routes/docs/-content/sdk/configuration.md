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

## Chrome slots

Replace parts of the widget's own chrome with host-rendered content, styled by the host page. In React they are plain props. On the vanilla handle they are `slots` renderers.

```tsx
<AstralBeamChat
  header={<MyChatTitle />}
  headerActions={<MyCloseButton />}
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
- Turning attachments off hides selected files and prevents sending them. Files remain in that conversation's in-memory draft if attachments are enabled again.
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

Duplicating a tab or opening one through an opener can copy its initial session storage. The tabs maintain independent selections afterwards.
