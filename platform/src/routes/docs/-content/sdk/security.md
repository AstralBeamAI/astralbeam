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

- Signed tickets authorize artifact downloads and bind them to the published bytes. No separate Bearer header is required.
- The serving route re-reads, re-sniffs (magic bytes, never extensions), re-caps, and re-hashes the bytes at download time. Any change since publishing is refused.
- Only sniffed raster images render inline. SVG can only ever be served as `text/plain`, and every response carries `nosniff` plus a frame-and-script-free CSP.
- Tickets expire in minutes alongside the sandbox's idle expiry. An expired download says to ask the agent again.

## What the SDK does not protect against

- Chat Markdown escapes raw HTML. Host widgets remain your responsibility, including how they handle agent-chosen props.
- The sandbox is isolated per conversation but holds no secrets by design. Never instruct an agent to write credentials into it.
