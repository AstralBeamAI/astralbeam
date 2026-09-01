# Security model

One principle everywhere: the dashboard grants, the chat endpoint enforces, and the client can only narrow a grant, never widen it. Nothing the browser sends is trusted for policy.

## The boundary

- Agent instructions live only in the dashboard; the endpoint rejects a browser-sent system prompt outright.
- Attachments are agent policy: the endpoint refuses files when the agent disallows them, and the widget hides the attach button after its capability handshake.
- The client's `attachments` option and limits can narrow the grant for UX; the endpoint enforces its own caps regardless.
- Tool and widget `execute`/`render` run in your page with agent-chosen input: validate with a Standard Schema, or treat the input as untrusted.

## Tokens

- Your server mints short-lived chat tokens (60–600 s) from the API key; the browser never sees the key.
- Tokens are bearer credentials: they stay in memory, ride in an `Authorization` header (no cookies, no CSRF surface), and must only ever reach the deployment that issued the API key.
- Self-hosted deployments must set `chatEndpoint` explicitly; the default points at the hosted cloud.

## Sandbox artifacts

- A published file is served by a short-lived signed ticket, minted server-side per file; the ticket is the whole download authorization, which is what lets an `<img>` load it.
- The serving route re-reads, re-sniffs (magic bytes, never extensions), and re-caps the bytes at download time; a file that changed since publishing is refused.
- Only sniffed raster images render inline; SVG can only ever be served as `text/plain`, and every response carries `nosniff` plus a frame-and-script-free CSP.
- Tickets die with the server process and the sandbox's idle expiry; an expired download says to ask the agent again.

## What the SDK does not protect against

- The chat endpoint's replies render as Markdown with raw HTML escaped, but widgets are your code: whatever they render with agent-chosen props is your responsibility.
- The sandbox is isolated per conversation but holds no secrets by design; never instruct an agent to write credentials into it.
