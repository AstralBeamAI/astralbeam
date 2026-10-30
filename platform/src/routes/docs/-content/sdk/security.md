# Security model

The dashboard defines agent capabilities and the server enforces them. SDK options can restrict those capabilities but cannot grant more access. Your backend remains responsible for authorizing host-tool actions.

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
- Proxied downloads verify stored size and hash before returning bytes. Direct S3 downloads authorize access before issuing a one-minute bearer URL for the previously verified object. That URL remains usable until expiry after access is revoked.
- Direct original downloads force attachment disposition. Generated WebP previews may render inline. Proxied responses retain `nosniff` and a frame-and-script-free CSP. Published artifact MIME types are sniffed, and SVG publishes as `text/plain`.
- The SDK fetches signed URLs without AstralBeam credentials or cookies and rejects further redirects. Storage CORS must allow the embedding origin. Model processing continues to read and verify stored bytes through the server.
- Published files survive sandbox shutdown and retire when the conversation is deleted. Temporary working files remain inside the sandbox.

## What the SDK does not protect against

- Chat Markdown escapes raw HTML. Host widgets remain your responsibility, including how they handle agent-chosen props.
- Sandboxes are scoped by tenant user, agent, and conversation, and hold no secrets by design. Never instruct an agent to write credentials into one.
- Once a host tool starts, stopping chat cannot undo its side effects. Your backend must authorize each action and handle uncertain outcomes safely.
