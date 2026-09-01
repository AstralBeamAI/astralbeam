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

| Option                           | Default                   | Meaning                                                                         |
| -------------------------------- | ------------------------- | ------------------------------------------------------------------------------- |
| `title`                          | `"AstralBeam"`            | Name in the widget's header                                                     |
| `showHeader`                     | `true`                    | `false` hides the header and its reset button                                   |
| `emptyTitle`, `emptyDescription` | generic copy              | Headline and subtitle of the empty transcript                                   |
| `systemPrompt`                   | the agent's stored prompt | Host instructions, up to 32,768 characters                                      |
| `colorScheme`                    | `"system"`                | `"light"`, `"dark"`, or follow the OS setting live                              |
| `theme`                          | built-in palette          | `{ light, dark }` CSS token overrides; see [Theming](./theming.md)              |
| `attachments`                    | `true`                    | `false` disables; an object narrows limits; see [Attachments](./attachments.md) |
| `tools`, `widgets`               | none                      | See [Tools and widgets](./tools-and-widgets.md)                                 |
| `debug`                          | `false`                   | Log every SDK action in the browser, and the run on the server                  |

## Behavior notes

- Assistant replies render as Markdown; raw HTML is escaped and executable link protocols are dropped.
- An update that turns attachments off also drops files already picked into the composer.
- Dropping a widget from `widgets` disposes any render of it still in the transcript.
