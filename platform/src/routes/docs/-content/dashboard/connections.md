# Connections

MCP connections give your agents tools from remote services. Let's connect a server, list its tools, and make them available to your agents.

## Connect a server

1. Open **Connections** in your Organization's dashboard and choose **Add server**.
2. Give it a name and enter its public HTTPS MCP endpoint. For a first test, use `https://docs.mcp.cloudflare.com/mcp` with **Public** authentication.
3. Choose who connects the account. **Organization shared account** makes one account available to every Tenant. The other choices require each Tenant or each person to connect separately.
4. Save the server. Public Organization defaults receive an account automatically. For other authentication types, choose **Add shared account**, or connect from **Connections** in the embedded assistant for Tenant or personal accounts.
5. For OAuth, choose **Connect account** and review the provider's permissions. Use **Automatic registration** where supported. Otherwise choose **Pre-registered application** and supply your provider's client ID and secret with the callback URI shown in the form.
6. Choose **Test connection**. A successful check reports the number of available tools. Connected accounts expose their tools on the next agent run, with the account name included in each tool's title.

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

For static authentication, declare the required header names on the server and enter their values on the account. Secret values are never returned by the management API. Leave all fields blank while editing to preserve existing credentials, or enter every value to replace them together.

For Google providers, choose the **Google** OAuth profile and a pre-registered application. Signing in to another provider with your Google account still uses that provider's standard MCP OAuth flow. It does not require the Google profile or forward your Google login token to the MCP endpoint.

## Account ownership and recovery

Organization defaults stay available when custom servers are disabled. **Custom server permissions** independently control whether Tenants can add shared servers and whether tenant users can add personal servers. Disabling a permission blocks existing custom connections while retaining their records for disconnect and deletion.

An account's ownership is fixed. Add another account for a different external identity or sharing scope. Sharing a server definition never shares someone's personal credentials. Tool results follow the conversation's existing visibility and retention rules.

**Disconnect locally** clears stored credentials. It does not revoke the provider's broader authorization grant. Use the provider's access-management page for that. If an account needs reconnection, choose **Connect account** again. Changing the server endpoint or authentication settings also requires reconnection.
