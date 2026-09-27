# Quickstart

AstralBeam gives your application an assistant that can act through your own functions. Let's connect an authenticated application, get a streamed reply, and give the assistant its first tool.

We need a web application with a server and an existing sign-in session, an AstralBeam organization, and an OpenAI API key with model access. No Tailwind, shadcn/ui, or sandbox provider is needed for this integration. For a complete example application, follow the [Todos tutorial](./todos-tutorial.md).

## 1. Create your organization

Open the [hosted dashboard](https://app.astralbeam.ai), sign up, then either accept an invitation to an existing organization or create your own. An Organization is your company or application, and its Tenants are your customers.

Creating one makes you its owner and provisions a starter agent, already set as the organization's default. Let's keep that agent for our first integration.

## 2. Connect OpenAI

Because every chat run uses your organization's own model key, an owner must open **Settings**, add an OpenAI API key, and select **Save key** before the agent can reply. This applies to both the hosted service and self-hosted deployments.

OpenAI bills model usage to the account that owns this key. This is a different credential from the AstralBeam API key we create next. See [organization settings](/docs/dashboard/settings) for storage and replacement details.

## 3. Create an AstralBeam API key

Owners and developers can create an organization API key. Its full value looks like `key_<organizationId>_<id>_abo_<secret>`, and the dashboard shows it exactly once, so copy it into your server's secret manager on the spot.

The key does two jobs. It authenticates calls to the [management API](/docs/api), and its secret signs the chat tokens your server mints. Anyone who can read it can mint a token naming any tenant user in your organization, so keep it server side and never ship it to browser code.

**NOTE**: Deleting a key invalidates both uses at once, including tokens already minted from it.

## 4. Install the SDK

Run this command to add the SDK to your application:

```sh
npm install @astralbeam/sdk
```

The package has no runtime dependencies. `react` and `react-dom` are optional peers, so the non-React entry points never load them.

## 5. Add a token endpoint

Let's register a `POST /api/astralbeam/token` route in your application. The widget calls that path on your application's origin by default and expects JSON containing `{ token }`. Store the AstralBeam key in the server's `ASTRALBEAM_API_KEY` secret, never in a browser-exposed variable such as `VITE_ASTRALBEAM_API_KEY`.

Adapt this handler to your framework's route format. `getApplicationSession` represents your existing server-side session lookup, which must also verify membership in the selected Tenant:

```ts
import { createAstralBeamToken } from "@astralbeam/sdk/server"

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" }
  const apiKey = process.env.ASTRALBEAM_API_KEY
  if (!apiKey) return Response.json({ error: "Not configured" }, { status: 503, headers })
  const session = await getApplicationSession(request)
  if (!session) return Response.json({ error: "Unauthenticated" }, { status: 401, headers })
  const token = await createAstralBeamToken({
    apiKey,
    user: { id: session.user.id, name: session.user.name },
    tenant: { id: session.tenant.id, name: session.tenant.name },
  })
  return Response.json({ token }, { headers })
}
```

We must derive `user` and `tenant` from your own trusted session, as everything the token asserts about who is chatting comes from that decision. A Tenant is one of your customers and a tenant user is one of that customer's users, so user IDs only need to be unique inside their Tenant. Both IDs must be stable, because they are the identity a conversation is attributed to.

Tokens last 60 to 600 seconds and default to 300. That short life is why the response must not be cached and why the SDK refetches on its own.

The full contract, including cross-origin endpoints and custom fetching, is in [SDK authentication](/docs/sdk/authentication).

## 6. Mount the widget

Add the component wherever the sidebar belongs:

```tsx
import { AstralBeamChat } from "@astralbeam/sdk/react"

export function Sidebar() {
  return (
    <aside style={{ height: "100dvh" }}>
      <AstralBeamChat title="Acme Assistant" />
    </aside>
  )
}
```

The widget fills its container, so the container needs a real height. It renders inside a shadow root, so your stylesheet and its styles cannot reach each other.

By default it talks to the hosted API at `https://app.astralbeam.ai/api`. A self-hosted deployment sets `apiUrl` to its own `/api` base, and a token must go to the deployment that issued its API key.

Mounting without React, updating options in place, and the layout rules are covered in [SDK getting started](/docs/sdk/getting-started).

## 7. Send the first message

Sign in to your own application and open the sidebar. A streamed reply means the token round trip, the API key, and the agent all resolved.

In your browser's network panel, the expected sequence is your token endpoint returning `{ token }`, AstralBeam's `POST /api/v1/me` returning `200`, and a request to `/api/v1/chat` streaming a reply. A disabled composer can mean token acquisition or current-user synchronization failed. The troubleshooting table below separates these steps.

## 8. Make the assistant change your app

A reply proves the connection works. Let's replace `Sidebar` with a component that gives the assistant a `create_task` tool and renders the tasks it creates:

```tsx
import { useState } from "react"
import { AstralBeamChat } from "@astralbeam/sdk/react"

export function TaskAssistant() {
  const [tasks, setTasks] = useState<Array<{ id: string; title: string }>>([])

  return (
    <div>
      <ul>{tasks.map((task) => <li key={task.id}>{task.title}</li>)}</ul>
      <aside style={{ height: "70dvh" }}>
        <AstralBeamChat
          title="Task Assistant"
          tools={{
            create_task: {
              description: "Create a task in the list visible to the user",
              parameters: {
                type: "object",
                properties: { title: { type: "string" } },
                required: ["title"],
              },
              execute: ({ title }) => {
                if (typeof title !== "string" || !title.trim() || title.length > 200) {
                  throw new Error("A task title must contain 1 to 200 characters")
                }
                const task = { id: crypto.randomUUID(), title: title.trim() }
                setTasks((current) => [...current, task])
                return task
              },
            },
          }}
        />
      </aside>
    </div>
  )
}
```

Ask, **“Create a task called Ship my first agent.”** The task should appear outside the chat and the assistant should confirm it. This example keeps tasks in React state, so reloading clears them. For your own app, call the same authenticated mutation your existing form uses, await its response, and enforce permissions on your server.

Plain JSON Schema describes the input to the model but does not validate it in the browser, which is why the tool checks its input. [Tools and widgets](/docs/sdk/tools-and-widgets) covers validators, live state, and rendering your components in chat.

## Agents and agent IDs

An agent is a named configuration: a system prompt, whether file attachments are allowed, and an optional sandbox provider. It is not a deployment or a process, so changing an agent changes the next conversation that uses it.

Every agent has a public ID of the form `agent_<organizationId>_<id>`. It carries no secret and is safe in browser code. Pass it as the SDK's `agentId` option, or omit that option and let each request resolve your organization's default agent.

The system prompt lives with the agent, so an embedding application cannot override it. The chat endpoint applies its own baseline instructions ahead of yours, so write yours as the persona and the rules for your product rather than as a whole prompt from scratch.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Empty or invisible widget | Give its container an explicit CSS height |
| Composer disabled with a retry link | Token acquisition or `POST /api/v1/me` synchronization failed. Inspect the failing request |
| `404` or `405` from `/api/astralbeam/token` | Register the route in your app as `POST`, or set `fetchAstralBeamToken` to your route |
| `401` from your own endpoint | No application session on the request |
| `503` from your own endpoint | The API key is missing from the server environment |
| `401` from AstralBeam | Check that your AstralBeam key is enabled and belongs to the deployment selected by `apiUrl` |
| `Org OpenAI key is not configured` | An owner must save the organization's OpenAI key in **Settings**, on hosted or self-hosted deployments |
| Provider authentication or quota error | Check the OpenAI key's model access, billing, and usage limits |
| Attachments refused | The agent does not allow them, and the chat endpoint enforces that whatever the client sends |

## Next

- [Todos tutorial](./todos-tutorial.md), a working application with host tools, an inline widget, attachments, and a sandbox.
- [SDK configuration](/docs/sdk/configuration), every option.
- [Tools and widgets](/docs/sdk/tools-and-widgets), let the agent act in and draw into your application.
- [SDK security model](/docs/sdk/security), who grants, who enforces, and what a client can change.
