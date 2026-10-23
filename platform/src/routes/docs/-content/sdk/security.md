# Security model

One principle everywhere: the dashboard grants, the chat endpoint enforces, and the client can only narrow a grant, never widen it. Nothing the browser sends is trusted for policy.

## The boundary

- Agent instructions live only in the dashboard. The endpoint rejects a browser-sent system prompt outright.
- Attachments are agent policy: the endpoint refuses files when the agent disallows them, and the widget hides the attach button after its capability handshake.
- The client's `attachments` option and limits can narrow the grant for UX. The endpoint enforces its own caps regardless.
- Tool and widget `execute`/`render` run in your page with agent-chosen input: validate with a Standard Schema, or treat it as untrusted. Authorize mutations against the backend's current session, Tenant, and resource ownership.
- Before invoking a host tool, the SDK rechecks its authorization after asynchronous validation. A verified identity change, reset, stop, disposal, tool removal, or schema replacement prevents pending execution.

## Tokens

- Your server mints short-lived chat auth tokens (60–600 s) from the API key. The browser never sees the key.
- Tokens stay in memory and use the `Authorization` header, without cookies. Send them only to the deployment that issued the API key.
- Self-hosted deployments must set `apiUrl` explicitly. The default points at the hosted cloud.

## Sandbox artifacts

- Published files are copied and verified in private storage before the tool returns. Downloads require your token and current conversation access.
- The download route verifies stored size and hash before returning any bytes. MIME types are sniffed at publication, never inferred from extensions.
- Only sniffed raster images render inline. SVG can only ever be served as `text/plain`, and every response carries `nosniff` plus a frame-and-script-free CSP.
- Published files survive sandbox shutdown and retire when the conversation is deleted. Temporary working files remain inside the sandbox.

## What the SDK does not protect against

- Chat Markdown escapes raw HTML. Host widgets remain your responsibility, including how they handle agent-chosen props.
- Sandboxes are scoped by tenant user, agent, and conversation, and hold no secrets by design. Never instruct an agent to write credentials into one.
- Once a host tool starts, stopping chat cannot undo its side effects. Your backend must authorize each action and handle uncertain outcomes safely.
