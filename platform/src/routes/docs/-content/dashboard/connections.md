# MCP servers

MCP servers provide tools from remote services. A server definition stores its endpoint and authentication settings. A connection stores the credentials used to access it. Let's add a server, connect to it, and make its tools available to your agents.

## Add a server and connect

1. Open **MCP servers** in the Organization dashboard and choose **Add MCP server**.
2. Enter the public HTTPS endpoint and choose **No authentication**, **API key / headers** or **OAuth**.
3. For OAuth, enter your embedded application's exact **Application origin**, such as `https://app.example.com`. The dashboard origin is always allowed.
4. For providers without automatic registration, select **Pre-registered application** under **OAuth setup** and enter its trusted authorization server issuer, client ID and secret. Obtain the issuer from the application provider, independently of the MCP server. Register the exact redirect URI shown in the form with your provider. The OAuth client selects the token authentication method from the provider's metadata.
5. Open **MCP connections** in your application's embedded sidebar. Choose **Connect** for OAuth or static authentication, or **Enable** for a public server.
6. Choose **Test connection** to discover and count the available tools. Connected tools are exposed to the agent when the next conversation run starts.

**NOTE**: This client supports MCP 2026-07-28 over Streamable HTTP, including JSON and request-scoped SSE responses. Older protocol revisions, stdio and private-network endpoints are unsupported. A provider's OAuth setup succeeding does not prove that its MCP endpoint supports this revision.

**NOTE**: Tool input fields marked with `x-mcp-header` are sent as arguments and copied into their declared `Mcp-Param-*` HTTP headers. Structured results require the server to declare an output schema.

Each run discovers at most 16 connected servers and exposes their tools. Additional connections are reported as unavailable for that run.

## Hosted examples for SaaS teams

These are practical starting points across engineering, product, sales and operations, rather than a market-share ranking. Each link points to the provider's setup instructions. Provider availability, permissions and tool catalogs can change.

| Server | SaaS use case | Endpoint | Authentication and setup |
| --- | --- | --- | --- |
| [Linear](https://linear.app/docs/mcp) | Issues, projects and roadmap context | `https://mcp.linear.app/mcp/readonly` | Automatic OAuth. This endpoint exposes only read tools. Use `/mcp` when write access is intended. |
| [GitHub](https://github.com/github/github-mcp-server/blob/main/docs/server-configuration.md) | Repositories, issues, pull requests and CI | `https://api.githubcopilot.com/mcp/x/all/readonly` | Follow GitHub's authentication instructions. A supported token can be stored as an `Authorization` static header. |
| [Notion](https://developers.notion.com/guides/mcp/overview) | Product specs, knowledge base and customer notes | `https://mcp.notion.com/mcp` | Automatic OAuth, with workspace permissions selected during authorization. |
| [Sentry](https://mcp.sentry.dev/) | Error triage and performance | `https://mcp.sentry.dev/mcp` | Automatic OAuth. Append your Sentry organization and project to narrow the catalog. |
| [HubSpot](https://developers.hubspot.com/ai-tools/mcp) | CRM contacts, deals, tickets and engagements | `https://mcp.hubspot.com` | Pre-registered user-level OAuth application. A HubSpot administrator must connect first. |
| [Stripe](https://docs.stripe.com/mcp) | Billing, subscriptions and payment operations | `https://mcp.stripe.com` | Automatic OAuth or an Agent API key as a static `Authorization` header. Select a sandbox and appropriate permissions. |
| [Supabase](https://supabase.com/docs/guides/ai-tools/mcp) | Database and application infrastructure | `https://mcp.supabase.com/mcp?read_only=true` | Automatic OAuth. Add `project_ref` to restrict it to a development project. |
| [Slack](https://docs.slack.dev/ai/slack-mcp-server/) | Team knowledge, conversations and search | `https://mcp.slack.com/mcp` | Pre-registered confidential OAuth application. Slack restricts MCP to internal or Marketplace apps. |
| [Intercom](https://developers.intercom.com/docs/guides/mcp) | Support conversations, contacts and help-center articles | `https://mcp.intercom.com/mcp` | Automatic OAuth or a bearer token. EU workspaces use `https://mcp.eu.intercom.com/mcp`. OAuth callbacks outside localhost need provider allowlisting. |
| [Atlassian](https://atlassian.github.io/atlassian-mcp-server/) | Jira, Confluence and service-management context | `https://mcp.atlassian.com/v2/mcp?tools=all` | OAuth or a provider-supported API token. `tools=all` exposes the paginated flat catalog instead of relying on on-demand tool discovery. |
| [Figma](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/) | Design context and implementation | `https://mcp.figma.com/mcp` | OAuth. New clients currently require admission to Figma's MCP catalog, so provider approval is needed before testing a custom client. |
| [Context7](https://github.com/upstash/context7) | Current library documentation for engineering | `https://mcp.context7.com/mcp` | Public access is available. A provider API key improves rate limits. |
| [Cloudflare Docs](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Infrastructure documentation | `https://docs.mcp.cloudflare.com/mcp` | Public. This is the documentation server, separate from Cloudflare's API server. |

For static authentication, declare header names on the server. Each person enters every value when connecting or replacing credentials. Secret values are never returned by the management API.

For Google providers, choose **Pre-registered application** and enter both the client ID and secret. Google is detected during authorization and requests offline access for token refresh. Signing in to another provider with your Google account uses that provider's OAuth flow and does not forward your Google login token to the MCP endpoint.

## Connection ownership and recovery

Organization admins manage the available server definitions. Each TenantUser can create one private connection per server. Tenant-managed and user-added servers, and shared credentials, are not supported yet. Tool results follow the conversation's existing visibility and retention rules.

Server settings are fixed after creation. Remove and add the definition again to change its endpoint or authentication. Users must then create new connections. Disconnect deletes the local connection and credentials without revoking provider-wide access. Connecting again creates a new connection.

Configure the OAuth scopes your tools require before connecting. Incremental consent during tool execution is deferred. If a tool requires additional permissions, update the server definition and authorize again.

Pre-registered server definitions created without a trusted issuer must be removed and added again with that issuer before reconnecting. Existing unbound OAuth connections require reauthorization.
