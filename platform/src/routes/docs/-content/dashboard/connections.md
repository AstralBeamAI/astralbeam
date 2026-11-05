# MCP servers

Connect services such as Linear, GitHub, or Notion so your assistant can use their tools. Add the server once in the dashboard, then let each user connect with their own credentials.

## Add a server and connect

1. Open **MCP servers** in the dashboard and choose **Add MCP server**.
2. Enter the public HTTPS endpoint and choose **No authentication**, **API key / headers**, or **OAuth**.
3. For OAuth, enter your embedded application's exact **Application origin**, such as `https://app.example.com`. Complete [application registration](#pre-registered-oauth-applications) if the provider requires it.
4. Save the server definition.
5. Open **MCP connections** in your embedded sidebar. Choose **Connect** for OAuth or static authentication, or **Enable** for a public server.
6. Choose **Test connection** and confirm that it discovers tools. Ask the assistant to use one of them, such as finding an issue. Tools become available on the next conversation run.

**NOTE**: Servers must support MCP 2026-07-28 over Streamable HTTP at a public HTTPS endpoint. Older revisions, stdio, and private-network endpoints are unsupported. A successful OAuth flow alone does not verify MCP compatibility.

## Hosted examples for SaaS teams

Use the provider's setup guide to get credentials and confirm availability, then run **Test connection**. Choose read-only access where it meets your use case.

| Server and setup | Endpoint | Authentication |
| --- | --- | --- |
| [Linear](https://linear.app/docs/mcp) | `https://mcp.linear.app/mcp/readonly` | OAuth. Read-only. Use `/mcp` for write access. |
| [GitHub](https://github.com/github/github-mcp-server/blob/main/docs/server-configuration.md) | `https://api.githubcopilot.com/mcp/x/all/readonly` | A supported token in an `Authorization` header. |
| [Notion](https://developers.notion.com/guides/mcp/overview) | `https://mcp.notion.com/mcp` | OAuth with your selected workspace permissions. |
| [Sentry](https://mcp.sentry.dev/) | `https://mcp.sentry.dev/mcp` | OAuth. Append an organization and project to narrow the catalog. |
| [HubSpot](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server) | `https://mcp.hubspot.com` | Pre-registered connector with client ID and secret. |
| [Stripe](https://docs.stripe.com/mcp) | `https://mcp.stripe.com` | OAuth or Agent API key. Select a sandbox and appropriate permissions. |
| [Supabase](https://supabase.com/docs/guides/ai-tools/mcp) | `https://mcp.supabase.com/mcp?read_only=true` | OAuth. Add `project_ref` to restrict to a development project. |
| [Slack](https://docs.slack.dev/ai/slack-mcp-server/) | `https://mcp.slack.com/mcp` | Pre-registered confidential OAuth app. Internal or Marketplace apps only. |
| [Intercom](https://developers.intercom.com/docs/guides/mcp) | `https://mcp.intercom.com/mcp` | OAuth or bearer token. Check region and client requirements. |
| [Atlassian](https://atlassian.github.io/atlassian-mcp-server/) | `https://mcp.atlassian.com/v2/mcp?tools=all` | OAuth or a supported API token. Keep `tools=all` for the flat catalog. |
| [Figma](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/) | `https://mcp.figma.com/mcp` | OAuth. New custom clients require provider approval. |
| [Context7](https://github.com/upstash/context7) | `https://mcp.context7.com/mcp` | API key in an `Authorization: Bearer` header. |
| [Cloudflare Docs](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | `https://docs.mcp.cloudflare.com/mcp` | No authentication. Documentation tools only. |

For static authentication, declare the header names on the server. Each person enters their values when connecting. Secret values are never returned by the management API.

## Pre-registered OAuth applications

For providers without automatic registration, select **Pre-registered application** under **OAuth setup**. Enter the authorization-server issuer, client ID, and secret. Obtain the issuer from the provider, and register the exact redirect URI shown in the form.

Google providers require both a client ID and secret. Using Google to sign in to another service still uses that service's OAuth flow.

## Connection ownership and recovery

Owners and developers manage available servers. Each TenantUser has one private connection per server with their own credentials. Tool results are saved with the conversation and follow its visibility rules.

To change an endpoint or authentication setup, remove and add the server again. Users must reconnect. Disconnecting removes the local credentials. Revoke access at the provider too if needed.

Configure the required OAuth scopes before connecting. If a tool needs more permissions, replace the server definition and authorize again.

Each run can use up to 16 connected servers. If tools are missing, check the connection test, granted scopes, and number of connected servers.
