# Security model

One principle everywhere: the dashboard grants, the chat endpoint enforces, and the client can only narrow a grant, never widen it. Nothing the browser sends is trusted for policy.

## The boundary

- Agent instructions live only in the dashboard. The endpoint rejects a browser-sent system prompt outright.
- Attachments are agent policy: the endpoint refuses files when the agent disallows them, and the widget hides the attach button after its capability handshake.
- The client's `attachments` option and limits can narrow the grant for UX. The endpoint enforces its own caps regardless.
- Tool and widget `execute`/`render` run in your page with agent-chosen input: validate with a Standard Schema, or treat the input as untrusted.

## Tokens

- Your server mints short-lived chat auth tokens (60–600 s) from the API key. The browser never sees the key.
- Tokens stay in memory and use the `Authorization` header, without cookies. Send them only to the deployment that issued the API key.
- Self-hosted deployments must set `apiUrl` explicitly. The default points at the hosted cloud.

## Sandbox artifacts

- Published artifacts are copied and verified in private storage before the tool returns. Stored file references use your tenant JWT and current conversation permissions. Administrative transcripts use their existing authorized attachment route.
- The serving route streams the stored bytes and verifies their size and hash. MIME types are sniffed at publication, never inferred from extensions.
- Only sniffed raster images render inline. SVG can only ever be served as `text/plain`, and every response carries `nosniff` plus a frame-and-script-free CSP.
- Stored artifacts survive sandbox shutdown. Conversation deletion schedules their object cleanup. Older unmigrated artifacts still use short-lived signed tickets, and unavailable historical sources ask the agent to regenerate the file.

## What the SDK does not protect against

- Chat Markdown escapes raw HTML. Host widgets remain your responsibility, including how they handle agent-chosen props.
- The sandbox is isolated per conversation but holds no secrets by design. Never instruct an agent to write credentials into it.
