# Quickstart

Let's add an assistant to your **React app** using your existing login.

[![Acme Assistant beside a sample app, showing a greeting and reply.](/docs/quickstart-preview.png)](/docs/quickstart-preview.png)

You'll need a backend using Better Auth with its [organization plugin](https://better-auth.com/docs/plugins/organization), plus a model-provider API key.

## 1. Prepare your agent

[Sign up](/auth/sign-up) and create an organization.

1. Open **[Models](/docs/dashboard/models)**, add your provider's API key, enable a model, and choose **Save provider**.
2. Choose **Test model** and wait for **replied successfully**. Your provider may charge for the test.
3. Open **[Agents](/docs/dashboard/agents)**, assign that model to the starter agent, and choose **Save changes**.
4. Open **[API Keys](/docs/dashboard/api-keys)** and create a key. Copy the full key now. You won't see it again.

## 2. Install and configure

Install the SDK:

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

Set the key in your backend's environment and restart the server:

```sh title="Server environment"
ASTRALBEAM_API_KEY=your_organization_api_key
```

**NOTE**: Keep the key out of browser code and version control. Anyone with it can impersonate your organization's tenant users.

## 3. Connect your backend

Register this handler as `POST /api/chat-token` in your backend.

Import your existing Better Auth server instance from `@/lib/auth`. Better Auth verifies the signed-in user's membership in the selected organization. Each organization in your app maps to an AstralBeam tenant.

Keep your backend's session and CSRF protections.

```ts title="src/server/chat-token.ts"
import { createAstralBeamToken } from "@astralbeam/sdk/server"
import { auth } from "@/lib/auth"

export async function POST(request: Request) {
  const member = await auth.api.getActiveMember({ headers: request.headers })
  const chatToken = await createAstralBeamToken({
    apiKey: process.env.ASTRALBEAM_API_KEY!,
    user: { id: member.userId },
    tenant: { id: member.organizationId },
  })
  return Response.json({ token: chatToken }, { headers: { "Cache-Control": "no-store" } })
}
```

## 4. Mount and test

Pass a function that calls your token handler:

```tsx title="src/Assistant.tsx"
"use client"

import { AstralBeamChat } from "@astralbeam/sdk/react"

async function fetchToken() {
  const response = await fetch("/api/chat-token", { method: "POST" })
  return response.json()
}

export function Assistant() {
  return (
    <aside style={{ height: "100dvh" }}>
      <AstralBeamChat fetchAstralBeamToken={fetchToken} />
    </aside>
  )
}
```

Mount `<Assistant />` in your app, sign in, and send **"Say hello in one sentence."** You should see a reply stream into the chat.

See [SDK props](/docs/sdk/configuration#options) to customize the assistant.

## Next

[Add tools and widgets](/docs/sdk/tools-and-widgets), or try the [Todos tutorial](./todos-tutorial.md). Read the [security model](/docs/sdk/security) before giving tools access to your app's data.

See [Authentication](/docs/sdk/authentication) for troubleshooting.
