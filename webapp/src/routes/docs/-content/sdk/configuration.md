# Configuration

Every option below is also a prop on `<AstralBeamChat>`. On the vanilla handle, `update(options)` applies any subset in place, keeping the transcript, the session, and live widget renders.

## Fixed at mount

These select the agent and build the transport, so changing them requires a fresh mount.

| Option         | Default                              | Meaning                                              |
| -------------- | ------------------------------------ | ---------------------------------------------------- |
| `agentId`      | organization's default agent         | `agt_<organization>_<agent>` from the dashboard      |
| `chatEndpoint` | `https://app.astralbeam.ai/api/chat` | The AstralBeam chat endpoint the widget streams from |
| `authEndpoint` | `/api/astralbeam/token`              | Your app's token endpoint                            |

- Self-hosted deployments must set `chatEndpoint` to their own origin; the default points at the hosted cloud, and chat tokens are bearer credentials that should only reach the deployment that issued the API key.

## Updatable

Prop or `update` changes apply immediately.

| Option                           | Default          | Meaning                                                                         |
| -------------------------------- | ---------------- | ------------------------------------------------------------------------------- |
| `title`                          | `"AstralBeam"`   | Name in the widget's header                                                     |
| `showHeader`                     | `true`           | `false` hides the header and its reset button                                   |
| `emptyTitle`, `emptyDescription` | generic copy     | Headline and subtitle of the empty transcript                                   |
| `colorScheme`                    | `"system"`       | `"light"`, `"dark"`, or follow the OS setting live                              |
| `theme`                          | built-in palette | `{ light, dark }` CSS token overrides; see [Theming](./theming.md)              |
| `attachments`                    | `true`           | `false` disables; an object narrows limits; see [Attachments](./attachments.md) |
| `sandboxPanel`                   | `false`          | Shows the collected sandbox panel; see [Sandbox](./sandbox.md)                  |
| `tools`, `widgets`               | none             | See [Tools and widgets](./tools-and-widgets.md)                                 |
| `debug`                          | `false`          | Log every SDK action in the browser, and the run on the server                  |

## Chrome slots

Replace parts of the widget's own chrome with host-rendered content, styled by the host page. In React they are plain props; on the vanilla handle they are `slots` renderers.

```tsx
<AstralBeamChat
  header={<MyChatHeader onReset={() => chatRef.current?.reset()} />}
  empty={<MyWelcome />}
  composerActions={<MyVoiceButton />}
/>
```

- `header` replaces the title and reset button; `showHeader={false}` still hides the whole row.
- `empty` replaces the empty-transcript state; `composerActions` adds controls next to send.
- Vanilla: `slots: { header: (container) => { ...; return cleanup } }`, updatable through `update`.

## Imperative control

The React component exposes a ref; the vanilla handle has the same methods.

```tsx
const chatRef = useRef<AstralBeamChatRef>(null)
// <AstralBeamChat ref={chatRef} /> — then:
chatRef.current?.reset() // clears transcript, drafts, attachments, widget renders
chatRef.current?.stop() // stops the in-flight generation
```

## Behavior notes

- Assistant replies render as Markdown; raw HTML is escaped and executable link protocols are dropped.
- An update that turns attachments off also drops files already picked into the composer.
- Dropping a widget from `widgets` disposes any render of it still in the transcript.
- To defer the chat chunk, render the component only on first open; hide with CSS afterwards, since unmounting discards the transcript.
