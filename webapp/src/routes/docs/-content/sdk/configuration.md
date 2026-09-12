# Configuration

Every option below is also a prop on `<AstralBeamChat>`. On the vanilla handle, `update(options)` applies any subset in place, keeping the transcript, the session, and live widget renders. Nothing is fixed at mount.

## Options

| Option                           | Default                            | Meaning                                                                           |
| -------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| `agentId`                        | organization's default agent       | `agent_<orgId>_<id>`, copied from the dashboard                                   |
| `apiUrl`                         | `https://app.astralbeam.ai/api`    | Base URL of the AstralBeam API, the widget streams from `/v1/chat`                |
| `fetchAstralBeamToken`           | `{ url: "/api/astralbeam/token" }` | Your chat auth token endpoint as `{ url, ...RequestInit }`, or a minting function |
| `title`                          | `"AstralBeam"`                     | Name in the widget's header                                                       |
| `showHeader`                     | `true`                             | `false` hides the header and its reset button                                     |
| `emptyTitle`, `emptyDescription` | generic copy                       | Headline and subtitle of the empty transcript                                     |
| `autoFocus`                      | `false`                            | Focuses the composer once the session is verified, so typing can start right away |
| `colorScheme`                    | `"system"`                         | `"light"`, `"dark"`, or follow the OS setting live                                |
| `theme`                          | built-in palette                   | `{ light, dark }` CSS token overrides, see [Theming](./theming.md)                |
| `attachments`                    | `true`                             | `false` disables, an object narrows limits. See [Attachments](./attachments.md)   |
| `sandboxPanel`                   | `false`                            | Shows the collected sandbox panel, see [Sandbox](./sandbox.md)                    |
| `tools`, `widgets`               | none                               | See [Tools and widgets](./tools-and-widgets.md)                                   |
| `debug`                          | `false`                            | Log SDK actions in the browser, with server logs in development only              |

- For self-hosting, set `apiUrl` to your deployment’s `/api` base. Send tokens only to the deployment that issued the API key.
- `apiUrl` is a base, not a route: the widget appends `/v1/chat` for the stream and its subroutes for the agent handshake and artifact downloads.
- `fetchAstralBeamToken` is the only chat auth token option. The request form's init reaches `fetch` as given. See [Authentication](./authentication.md).
- Transport options are read per request. Updated `apiUrl`, `fetchAstralBeamToken`, and `agentId` values apply to the next request or run.
- Changing `agentId` keeps the transcript, which the new agent then sees as history. Call `reset()` first for a clean conversation.
- `autoFocus` applies once per mount, after the chat auth token resolves, and never when your page already holds focus, so it cannot pull the caret out of one of your own fields. Mobile browsers raise the on-screen keyboard only for a focus that follows a tap, so on a phone it places the caret without necessarily opening the keyboard.
- A tap anywhere inside the composer's box focuses the message input, the attach and send buttons aside, so a thumb does not have to land on the text itself.
- Every option accepts an explicit `undefined` and reads as unset, so a value you do not have yet needs no conditional prop under `exactOptionalPropertyTypes`.

## Chrome slots

Replace parts of the widget's own chrome with host-rendered content, styled by the host page. In React they are plain props. On the vanilla handle they are `slots` renderers.

```tsx
<AstralBeamChat
  header={<MyChatHeader onReset={() => chatRef.current?.reset()} />}
  empty={<MyWelcome />}
  composerActions={<MyVoiceButton />}
/>
```

- `header` replaces the title and reset button. `showHeader={false}` still hides the whole row.
- `empty` replaces the empty-transcript state. `composerActions` adds controls next to send.
- Vanilla: `slots: { header: (container) => { ...; return cleanup } }`, updatable through `update`.

## Imperative control

The React component exposes a ref. The vanilla handle has the same methods.

```tsx
const chatRef = useRef<AstralBeamChatRef>(null)
// After mounting <AstralBeamChat ref={chatRef} />:
chatRef.current?.reset() // clears transcript, drafts, attachments, widget renders
chatRef.current?.stop() // stops the in-flight generation
```

## Behavior notes

- Assistant replies render as Markdown. Raw HTML is escaped and executable link protocols are dropped.
- An update that turns attachments off also drops files already picked into the composer.
- Dropping a widget from `widgets` disposes any render of it still in the transcript.
- To defer the chat chunk, render the component only on first open. Hide with CSS afterwards, since unmounting discards the transcript.
