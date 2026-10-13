# Connections

MCP connections give your agents tools from remote services. Let's connect a server, list its tools, and make them available to your agents.

## Connect a server

1. Open **Connections** in the Organization dashboard and choose **Add server**.
2. Enter the public HTTPS endpoint and choose public, static-header or OAuth authentication.
3. For providers without automatic registration, enable **Use a pre-registered OAuth application** and enter its client ID and secret. Register the exact redirect URI shown in the form with your provider.
4. Open **Connections** in your application's embedded sidebar. Each person chooses **Connect account** and authorizes their own account or enters their own header values.
5. Choose **Test connection** to list the available tools. Connected tools are exposed to the agent when the next conversation run starts.

**NOTE**: This client supports MCP 2026-07-28 over Streamable HTTP, including JSON and request-scoped SSE responses. Older protocol revisions, stdio and private-network endpoints are unsupported. A provider's OAuth setup succeeding does not prove that its MCP endpoint supports this revision.

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

For Google providers, choose the **Google** OAuth profile and a pre-registered application. Signing in to another provider with your Google account still uses that provider's standard MCP OAuth flow. It does not require the Google profile or forward your Google login token to the MCP endpoint.

## Account ownership and recovery

Each connection belongs to one TenantUser. One account per server is supported. Shared accounts and user-added servers are deferred. Tool results follow the conversation's existing visibility and retention rules.

Server settings are fixed after creation. Remove and add the definition again to change its endpoint or authentication. Existing accounts must reconnect. Disconnect clears local credentials without revoking provider-wide access.
