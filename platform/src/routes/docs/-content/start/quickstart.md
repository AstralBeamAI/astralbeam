# Quickstart

Let's add a chat assistant to your app. We'll create an API key, install the SDK, add a token endpoint, mount the chat widget, and send a first message. Your dashboard's home page walks through the same steps, marks each one done, and shows when your first reply arrives.

[![Acme Assistant beside a sample app, showing a greeting and reply.](/docs/quickstart-preview.png)](/docs/quickstart-preview.png)

You'll need an app with a backend. For self-hosting, complete [Deploy](/docs/self-hosting/deploy) first.

**TIP**: Using Cursor, Claude Code, or Codex? Choose **Copy setup prompt** on your dashboard's home page and paste it into your coding agent, or follow the [coding-agent guide](/docs/cli/coding-agents#integrate-your-app).

## 1. Create an API key

Your server signs chat tokens with this key. [Sign up](/auth/sign-up) and create an organization, or [join your team's](/docs/dashboard/members#accepting-an-invitation). New organizations come with an agent that is ready to reply.

1. Choose **Create API key** on your dashboard's home page, or open **[API keys](/docs/dashboard/api-keys)**.
2. Copy the full key now. You won't see it again.

Add the key to your server's environment, then restart your server:

```env title=".env"
ASTRALBEAM_API_KEY=your_api_key
```

**NOTE**: Keep the key out of browser code and version control. Anyone with it can impersonate your organization's tenant users.

## 2. Install the SDK

<!-- ::start:tabs variant="files" -->

```sh title="npm"
npm install @astralbeam/sdk
```

```sh title="pnpm"
pnpm add @astralbeam/sdk
```

```sh title="yarn"
yarn add @astralbeam/sdk
```

```sh title="bun"
bun add @astralbeam/sdk
```

<!-- ::end:tabs -->

Using Rails or a backend without a bundler? Skip this step and use the **Script tag** option in step 4.

## 3. Create the token endpoint

The widget calls `POST /api/astralbeam/token` to get a short-lived token for the signed-in user. Choose your backend:

<!-- ::start:tabs -->

### Next.js

```ts title="app/api/astralbeam/token/route.ts"
import { createAstralBeamToken } from "@astralbeam/sdk/server"

export async function POST() {
  // The test IDs below are not authenticated, so this refuses production until you replace them
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 401 })
  const token = await createAstralBeamToken({
    apiKey: process.env.ASTRALBEAM_API_KEY!,
    user: { id: "test-user" }, // Replace with the signed-in user's ID
    tenant: { id: "test-org" }, // Replace with the user's account or organization ID
  })
  return Response.json({ token }, { headers: { "Cache-Control": "no-store" } })
}
```

### TanStack Start

```ts title="src/routes/api/astralbeam/token.ts"
import { createAstralBeamToken } from "@astralbeam/sdk/server"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/astralbeam/token")({
  server: {
    handlers: {
      POST: async () => {
        // The test IDs below are not authenticated, so this refuses production until you replace them
        if (process.env.NODE_ENV === "production") return new Response(null, { status: 401 })
        const token = await createAstralBeamToken({
          apiKey: process.env.ASTRALBEAM_API_KEY!,
          user: { id: "test-user" }, // Replace with the signed-in user's ID
          tenant: { id: "test-org" }, // Replace with the user's account or organization ID
        })
        return Response.json({ token }, { headers: { "Cache-Control": "no-store" } })
      },
    },
  },
})
```

### Express

```ts title="server.ts"
import { createAstralBeamToken } from "@astralbeam/sdk/server"

// Add this route to your existing Express app
app.post("/api/astralbeam/token", async (req, res) => {
  // The test IDs below are not authenticated, so this refuses production until you replace them
  if (process.env.NODE_ENV === "production") return res.sendStatus(401)
  const token = await createAstralBeamToken({
    apiKey: process.env.ASTRALBEAM_API_KEY!,
    user: { id: "test-user" }, // Replace with the signed-in user's ID
    tenant: { id: "test-org" }, // Replace with the user's account or organization ID
  })
  res.set("Cache-Control", "no-store").json({ token })
})
```

### Rails

```ruby title="config/routes.rb"
post "/api/astralbeam/token", to: "astralbeam_tokens#create"
```

```ruby title="app/controllers/astralbeam_tokens_controller.rb"
# Add gem "jwt" to your Gemfile
require "jwt"
require "digest"
require "base64"

class AstralbeamTokensController < ApplicationController
  def create
    # The test IDs below are not authenticated, so this refuses production until you replace them
    return head :unauthorized if Rails.env.production?

    key_id, _, secret = ENV.fetch("ASTRALBEAM_API_KEY").rpartition("_abo_")
    signing_key = Base64.urlsafe_encode64(Digest::SHA256.digest("abo_#{secret}"), padding: false)
    claims = {
      ver: 4, iss: key_id.split("_")[1], aud: "astralbeam",
      iat: Time.current.to_i, exp: 5.minutes.from_now.to_i,
      user: { id: "test-user" }, # Replace with the signed-in user's ID
      tenant: { id: "test-org" } # Replace with the user's account or organization ID
    }
    token = JWT.encode(claims, signing_key, "HS256", { typ: "astralbeam+jwt", kid: key_id })
    response.headers["Cache-Control"] = "no-store"
    render json: { token: token }
  end
end
```

<!-- ::end:tabs -->

Don't use test IDs in production. Set `user.id` and `tenant.id` from your session, never the request body, as described in [Identify your real users](./customize.md#identify-your-real-users). For other languages, use the [token format](/docs/sdk/authentication#mint-tokens-without-javascript).

## 4. Mount the chat widget

Render the widget in a container with a set height:

<!-- ::start:tabs -->

### React

```tsx title="src/components/sidebar.tsx"
"use client"

import { AstralBeamChat } from "@astralbeam/sdk/react"

export function Sidebar() {
  return (
    <aside style={{ height: "100dvh" }}>
      <AstralBeamChat apiUrl="https://astralbeam.ai/api" />
    </aside>
  )
}
```

### TypeScript

```ts title="src/sidebar.ts"
import { mountAstralBeamChat } from "@astralbeam/sdk/client"

const container = document.getElementById("sidebar")!
container.style.height = "100dvh"
mountAstralBeamChat(container, { apiUrl: "https://astralbeam.ai/api" })
```

### Script tag

```html title="index.html"
<div id="sidebar" style="height: 100dvh"></div>
<script type="module">
  import { mountAstralBeamChat } from "https://cdn.jsdelivr.net/npm/@astralbeam/sdk@0.30.6/dist/client.js"

  mountAstralBeamChat(document.getElementById("sidebar"), { apiUrl: "https://astralbeam.ai/api" })
</script>
```

<!-- ::end:tabs -->

For self-hosting, replace `https://astralbeam.ai/api` with your deployment's API URL, such as `https://your-deployment.example/api`. Your dashboard's guide fills it in for you.

Does your endpoint use another URL or headers, such as Rails' CSRF token? Pass `fetchAstralBeamToken`, as shown in [Customize token requests](/docs/sdk/authentication#where-the-token-comes-from).

## 5. Send your first message

Open your app and send **"Say hello in one sentence."** A reply should stream into the chat, and your dashboard's guide shows that your app is connected.

If chat cannot connect, check the token endpoint in your browser's Network panel and follow [authentication troubleshooting](/docs/sdk/authentication#troubleshooting).

## Customize your setup

With chat working, let's tune it for your app:

- [Match your brand](/docs/sdk/theming) by setting the widget's title, colors, and theme.
- [Add tools and widgets](/docs/sdk/tools-and-widgets) to let the assistant read and change your app's data.
- [Shape your agent](/docs/dashboard/agents) by editing its instructions, model, and tools.
- [Connect model providers](/docs/dashboard/models) to add provider keys and choose the models your agents use.
- [Add a sandbox](/docs/dashboard/sandboxes) to let agents run code and work with files.
- [Connect MCP servers](/docs/dashboard/connections) to give agents tools from external services.
- [Review usage limits](/docs/dashboard/usage-limits) to cap tokens or spend for your organization, customers, and users.
- [Invite teammates](/docs/dashboard/members) to add developers and viewers to your organization.

See [every way to customize your setup](./customize.md), or follow the [Todos tutorial](./todos-tutorial.md) to connect tools and live widgets. Read the [security model](/docs/sdk/security) before connecting production actions.
