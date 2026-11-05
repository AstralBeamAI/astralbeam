# Configuration

Customize the chat sidebar with props on `<AstralBeamChat>` or options on `mountAstralBeamChat`. Defaults work for most embeds. Connect authentication with the [Quickstart](/docs/start/quickstart) first.

```tsx
<AstralBeamChat title="Acme Assistant" colorScheme="system" />
```

In JavaScript, call the mount handle's `update(options)` to change presentation without remounting.

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

Give chat's parent a definite height. The sidebar fills that height and resizes horizontally within its parent.

Set `defaultWidth` to pixels or `"100%"`, or leave it unset to use the initial CSS width. User-resized widths are saved across reloads and take precedence. Give independent chats distinct mount `id` values so they keep separate width preferences.

Use `resizeContainer={() => layoutRef.current}` when an outer layout should limit width. Set `resizable={false}` to hide the resize edge. With `onClose`, chat fills the viewport on mobile and asks your application to dismiss it.

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

## Behavior notes

Your application controls when the sidebar appears. Mount it on first open to defer loading. Keep the session owner mounted if a response should continue while its view is hidden.

Changing `placementKey` selects that placement's remembered conversation and draft. An explicit `threadId` takes precedence. Placement keys organize local state and do not restrict access to history.

Turning attachments off prevents sending them but preserves ready files in the draft. Removing a registered widget disposes its existing renders. See [Attachments](./attachments.md) and [Tools and widgets](./tools-and-widgets.md) for details.

## Saved conversations

Conversations save automatically and start private. Users can reopen, rename, and continue their history across devices.

```tsx
<AstralBeamChat />                    // Restore this tab, or start new
<AstralBeamChat threadId="new" />      // Start fresh
<AstralBeamChat threadId={threadId} /> // Open a saved thread
```

The default `threadId="auto"` restores this tab's selection after authentication. Independent tabs start a new chat, while duplicated tabs may inherit their initial selection and draft.

If a connection drops, saved input, accepted tool results, and the last saved partial reply remain available. Reopening history never repeats a business tool. Resolve any unconfirmed action before continuing its turn.

`reset()` starts another conversation. Managers can delete conversations, removing their saved messages and uploaded files without undoing tool actions. Published sandbox files stay with their conversation, while temporary workspace files can disappear when the sandbox stops.

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

`onCreateServer` receives the endpoint and authentication configuration. Return field errors as `{ errors: [{ field: "endpointUrl", message: "Enter a public HTTPS URL." }] }`. `oauthRedirectUri` displays the provider callback URI.

Vanilla hosts use `mountAstralBeamMcpServers(element, options)` from `@astralbeam/sdk/client`, then call `update(options)` or `unmount()`. Unmount when identity or management scope changes, or change the React `key`, to clear pending form values. The component does not grant permissions or create a new management API. Currently, Organization admins manage server definitions and TenantUsers manage their own connections through chat's **MCP connections** panel.
