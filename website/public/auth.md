# AstralBeam authentication

Connect your agent to AstralBeam's MCP endpoint at `https://astralbeam.ai/mcp` to call the public organization APIs. Self-hosted deployments use `/mcp` on their own platform origin.

This guide documents existing organization API keys. AstralBeam does not currently implement the WorkOS auth.md registration protocol, anonymous provisioning, identity-assertion exchange, or OAuth authorization for agents. Use credentials supplied by the operator. Never collect their dashboard password or reuse dashboard session cookies.

## Authenticate

1. Sign in to the AstralBeam dashboard and select your organization.
2. As an owner or developer, create a dedicated API key in API keys.
3. Add a remote Streamable HTTP MCP server to your agent using the URL above and an `Authorization: Bearer <organization-api-key>` header. `X-API-Key` is also accepted and takes precedence when both headers are present.
4. Store the key in your agent client's secret configuration or environment. Never put it in prompts, source control, browser code, or URLs.
5. Call `getOrganization` and confirm its ID and name before changing records.

Dashboard cookies and tenant-user tokens do not authenticate `/mcp`. Browser-origin requests are rejected because organization keys are server credentials.

Read <a href="https://astralbeam.ai/agents.md" target="_blank" rel="noopener noreferrer">agents.md</a> for the tools and operational workflow.

## Compatible client example

The endpoint requires MCP `2026-07-28` over stateless Streamable HTTP, including per-request protocol metadata. Clients that use the legacy `initialize` handshake cannot connect, even if they support Streamable HTTP.

This example uses the official TypeScript client `2.4.0` with the protocol explicitly pinned. In a scratch directory, install the client:

```sh
bun add --exact @modelcontextprotocol/client@2.4.0
```

Set `ASTRALBEAM_API_KEY` through your secret manager or shell environment. For self-hosting, also set `ASTRALBEAM_MCP_URL` to your platform's `/mcp` URL. Save this as `connect.ts`:

```ts
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"

const key = process.env.ASTRALBEAM_API_KEY
if (!key) throw new Error("Set ASTRALBEAM_API_KEY")
const client = new Client(
  { name: "astralbeam-example", version: "1" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
)
try {
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(process.env.ASTRALBEAM_MCP_URL ?? "https://astralbeam.ai/mcp"),
      { requestInit: { headers: { Authorization: `Bearer ${key}` } } },
    ),
  )
  console.log(await client.listTools())
  console.log(await client.callTool({ name: "getOrganization", arguments: {} }))
  console.log(
    await client.callTool({
      name: "searchDocumentation",
      arguments: { query: { q: "API authentication" } },
    }),
  )
} finally {
  await client.close()
}
```

Run `bun run connect.ts` to discover tools, confirm the organization, and search documentation. The example only reads data.

## Access and revocation

An organization API key has organization-wide authority for these APIs. It does not impersonate the member who created it or inherit that member's role. Viewers cannot create keys. Use a dedicated key for each agent connection and delete it in the dashboard to revoke access.

Requests retain the key's existing expiry and rate limits. Every MCP request verifies the key once and consumes one request from its quota. Tool operations retain the REST API's resource authorization. Failed tool operations return the API's safe error response with `isError: true`.

## Recover from errors

- `401`: the key is missing, malformed, disabled, expired, or revoked. Stop and ask the operator to check the configured key.
- `403`: access or the request origin is forbidden. Do not retry with broader credentials automatically.
- `404`: the record is absent or outside the key's organization. Check the organization and returned UUIDs.
- `429`: wait for `Retry-After` before retrying. REST failures inside tool results include their safe problem body.
- After an interrupted create, look up the exact external identity before retrying because the write may already have committed.

Read the <a href="https://astralbeam.ai/docs/api/authentication" target="_blank" rel="noopener noreferrer">authentication guide</a>, <a href="https://astralbeam.ai/api/openapi.json" target="_blank" rel="noopener noreferrer">OpenAPI contract</a>, and <a href="https://astralbeam.ai/agent-skills/astralbeam/SKILL.md" target="_blank" rel="noopener noreferrer">AstralBeam integration skill</a> for API and app-integration details.
