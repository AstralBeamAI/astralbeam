# Quickstart

An embedded agent has three parts: an agent you configure in the dashboard, an API key your server holds, and the widget in your page. Your server authenticates its own users and mints a short-lived chat token for each one, so the widget never sees the API key.

This page is the shortest path to a working conversation. Each step links to the reference that owns it.

## Create your organization

Sign up, then either accept an invitation to an existing organization or create your own. An organization is the boundary that owns your agents, sandbox providers, API keys, members, and tenants.

Creating one makes you its owner and provisions a starter agent named after the organization, already set as the organization's default. You can send your first message before you have configured anything.

## Know what an agent is

An agent is a named configuration: a system prompt, whether file attachments are allowed, and an optional sandbox provider. It is not a deployment or a process. Changing an agent changes the next conversation that uses it.

Every agent has a public ID of the form `agent_<organizationId>_<id>`. It contains no secret and is safe in browser code. Pin it with the SDK's `agentId` option, or omit that option and let each request resolve your organization's default agent.

The system prompt lives with the agent, so an embedding application cannot override it. The chat endpoint applies its own baseline instructions ahead of yours, so write yours as the persona and the rules for your product rather than as a whole prompt from scratch.

## Create an API key

Owners and developers can create an organization API key. Its full value looks like `key_<organizationId>_<id>_abo_<secret>` and the dashboard shows it exactly once, so store it in your server's secret manager on the spot.

The key does two jobs. It authenticates calls to the [management API](/docs/api), and its secret is the signing material for the chat tokens your server mints. Anyone who can read it can mint a token for any tenant user in your organization, so keep it server side and never ship it to the browser. Deleting a key invalidates both uses immediately, including tokens already minted from it.

## Install the SDK

```sh
npm install @astralbeam/sdk
```

The package has no runtime dependencies. `react` and `react-dom` are optional peers, so the non-React entry points never load them.

## Add a token endpoint

The widget asks your server for a chat token and expects `{ token }` in reply. `createAstralBeamToken` is the only server helper you need.

```ts
import { createAstralBeamToken } from "@astralbeam/sdk/server"

export async function POST(request: Request) {
  const session = await getApplicationSession(request)
  if (!session) return Response.json({ error: "Unauthenticated" }, { status: 401 })
  const token = await createAstralBeamToken({
    apiKey: process.env.ASTRALBEAM_API_KEY!,
    user: { id: session.user.id, name: session.user.name },
    tenant: { id: session.tenant.id, name: session.tenant.name },
  })
  return Response.json({ token }, { headers: { "cache-control": "no-store" } })
}
```

Derive `user` and `tenant` from your own trusted session, never from anything the browser sent. A Tenant is one of your customers and a tenant user is one of that customer's users, so user IDs only need to be unique inside their Tenant. Both IDs must be stable, because they are the identity the conversation is attributed to.

Tokens last 60 to 600 seconds and default to 300. That short life is why the response must not be cached and why the SDK refetches on its own.

Full contract, including cross-origin endpoints and custom fetching: [SDK authentication](/docs/sdk/authentication).

## Mount the widget

```tsx
import { AstralBeamChat } from "@astralbeam/sdk/react"

export function Sidebar() {
  return (
    <aside className="flex h-dvh min-h-0 flex-col">
      <AstralBeamChat title="Acme Assistant" />
    </aside>
  )
}
```

The widget fills its container, so the container needs a real height. It renders inside a shadow root, so your stylesheet and its styles cannot reach each other.

By default it talks to the hosted API at `https://app.astralbeam.ai/api`. A self-hosted deployment sets `apiUrl` to its own `/api` base, and a token must go to the same deployment that issued its API key.

Mounting without React, updating options in place, and the layout rules are covered in [SDK getting started](/docs/sdk/getting-started).

## Verify

Sign in to your own application and send a message. A reply means the token round trip, the API key, and the agent all resolved.

If the composer is disabled with an error, your token endpoint failed rather than the agent. Check that it returns `{ token }`, that the request carries your session, and that the API key is present on the server.

## Troubleshooting

| Symptom                                        | Cause                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Composer disabled with a retry link            | The token fetch failed or returned something other than `{ token }`                         |
| `401` from your own endpoint                   | No application session on the request                                                       |
| `503` from your own endpoint                   | The API key is missing from the server environment                                          |
| Chat requests fail on a self-hosted deployment | The deployment has no model provider key configured yet                                     |
| Attachments refused                            | The agent does not allow them, and the chat endpoint enforces that regardless of the client |

## Next

- [Todos tutorial](./todos-tutorial.md), a working application with host tools, an inline widget, attachments, and a sandbox.
- [SDK configuration](/docs/sdk/configuration), every option.
- [Tools and widgets](/docs/sdk/tools-and-widgets), let the agent act in and draw into your application.
- [SDK security model](/docs/sdk/security), who grants, who enforces, and what a client can change.
