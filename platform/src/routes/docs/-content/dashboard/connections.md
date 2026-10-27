# MCP servers

Connect remote tools through MCP. An organization defines the available servers, and each user connects with their own credentials.

## Add a server and connect

1. Open **MCP servers** in the Organization dashboard and choose **Add MCP server**.
2. Enter the public HTTPS endpoint and choose **No authentication**, **API key / headers** or **OAuth**.
3. For OAuth, enter your embedded application's exact **Application origin**, such as `https://app.example.com`. The dashboard origin is always allowed. Complete [pre-registered application setup](#pre-registered-oauth-applications) if the provider requires it.
4. Save the server definition.
5. Open **MCP connections** in your application's embedded sidebar. Choose **Connect** for OAuth or static authentication, or **Enable** for a public server.
6. Choose **Test connection** and confirm that it discovers tools. They become available on the next conversation run. A saved definition or completed OAuth flow alone does not prove the connection works.

**NOTE**: This client supports MCP 2026-07-28 over Streamable HTTP, including JSON and request-scoped SSE responses. Older protocol revisions, stdio and private-network endpoints are unsupported. A provider's OAuth setup succeeding does not prove that its MCP endpoint supports this revision.

**NOTE**: Tool input fields marked with `x-mcp-header` are sent as arguments and copied into their declared `Mcp-Param-*` HTTP headers. Structured results require the server to declare an output schema.

Each run discovers at most 16 connected servers and exposes their tools. Additional connections are reported as unavailable for that run.

## Hosted examples for SaaS teams

These are provider-published endpoints. Follow the linked setup and use **Test connection** to verify compatibility with the protocol above. Availability and tool catalogs can change.

| Server | SaaS use case | Endpoint | Authentication and setup |
| --- | --- | --- | --- |
| [Linear](https://linear.app/docs/mcp) | Issues, projects and roadmap context | `https://mcp.linear.app/mcp/readonly` | Automatic OAuth. This endpoint exposes only read tools. Use `/mcp` when write access is intended. |
| [GitHub](https://github.com/github/github-mcp-server/blob/main/docs/server-configuration.md) | Repositories, issues, pull requests and CI | `https://api.githubcopilot.com/mcp/x/all/readonly` | Follow GitHub's authentication instructions. A supported token can be stored as an `Authorization` static header. |
| [Notion](https://developers.notion.com/guides/mcp/overview) | Product specs, knowledge base and customer notes | `https://mcp.notion.com/mcp` | Automatic OAuth, with workspace permissions selected during authorization. |
| [Sentry](https://mcp.sentry.dev/) | Error triage and performance | `https://mcp.sentry.dev/mcp` | Automatic OAuth. Append your Sentry organization and project to narrow the catalog. |
| [HubSpot](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server) | CRM contacts, deals, tickets and engagements | `https://mcp.hubspot.com` | Pre-registered MCP connector with a client ID and secret. Follow the provider's connector setup. |
| [Stripe](https://docs.stripe.com/mcp) | Billing, subscriptions and payment operations | `https://mcp.stripe.com` | Automatic OAuth or an Agent API key as a static `Authorization` header. Select a sandbox and appropriate permissions. |
| [Supabase](https://supabase.com/docs/guides/ai-tools/mcp) | Database and application infrastructure | `https://mcp.supabase.com/mcp?read_only=true` | Automatic OAuth. Add `project_ref` to restrict it to a development project. |
| [Slack](https://docs.slack.dev/ai/slack-mcp-server/) | Team knowledge, conversations and search | `https://mcp.slack.com/mcp` | Pre-registered confidential OAuth application. Slack restricts MCP to internal or Marketplace apps. |
| [Intercom](https://developers.intercom.com/docs/guides/mcp) | Support conversations, contacts and help-center articles | `https://mcp.intercom.com/mcp` | OAuth or a bearer token. Follow the provider's current region and OAuth client requirements. |
| [Atlassian](https://atlassian.github.io/atlassian-mcp-server/) | Jira, Confluence and service-management context | `https://mcp.atlassian.com/v2/mcp?tools=all` | OAuth or a provider-supported API token. `tools=all` exposes the paginated flat catalog instead of relying on on-demand tool discovery. |
| [Figma](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/) | Design context and implementation | `https://mcp.figma.com/mcp` | OAuth. New clients currently require admission to Figma's MCP catalog, so provider approval is needed before testing a custom client. |
| [Context7](https://github.com/upstash/context7) | Current library documentation for engineering | `https://mcp.context7.com/mcp` | Configure the provider API key as a static `Authorization: Bearer` header, following its setup instructions. |
| [Cloudflare Docs](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Infrastructure documentation | `https://docs.mcp.cloudflare.com/mcp` | Public. This is the documentation server, separate from Cloudflare's API server. |

For static authentication, declare header names on the server. Each person enters every value when connecting or replacing credentials. Secret values are never returned by the management API.

## Pre-registered OAuth applications

For providers without automatic registration, select **Pre-registered application** under **OAuth setup**. Enter the trusted authorization-server issuer, client ID, and secret. Obtain the issuer independently from the application provider, and register the exact redirect URI shown in the form. The OAuth client selects the token authentication method from provider metadata.

Google providers require this setup with both the client ID and secret. Authorization requests offline access for token refresh. Using Google to sign in to another provider still uses that provider's OAuth flow and does not forward your Google token to its MCP endpoint.

## Connection ownership and recovery

Organization owners and developers manage the available server definitions. Each TenantUser can create one private connection per server. Tenant-managed and user-added servers, and shared credentials, are not supported yet. Tool results follow the conversation's existing visibility and retention rules.

Server settings are fixed after creation. Remove and add the definition again to change its endpoint or authentication. Users must then create new connections. Disconnect deletes the local connection and credentials without revoking provider-wide access. Connecting again creates a new connection.

Configure the OAuth scopes your tools require before connecting. Incremental consent during tool execution is deferred. If a tool requires additional permissions, update the server definition and authorize again.

Pre-registered server definitions created without a trusted issuer must be removed and added again with that issuer before reconnecting. Existing unbound OAuth connections require reauthorization.
