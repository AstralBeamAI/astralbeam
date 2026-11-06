# Quickstart

Add a chat assistant to your React app using your existing login. You'll create an API key, add a token endpoint, and send your first message.

Using another stack? Follow the same model and backend setup below, then [mount with JavaScript](/docs/sdk/getting-started) or a [script tag](/docs/sdk/script-tag). For help from Cursor, Claude Code, or Codex, start with the [coding-agent guide](/docs/start/coding-agents).

[![Acme Assistant beside a sample app, showing a greeting and reply.](/docs/quickstart-preview.png)](/docs/quickstart-preview.png)

You'll need a React app with an authenticated backend. For self-hosting, complete [Deploy](/docs/self-hosting/deploy) first.

**TIP**: Your dashboard's home page walks through these steps with code for Next.js, TanStack Start, Express, and Rails, and shows when your first reply arrives.

## 1. Create an API key

Use your existing organization, [join your team's](/docs/dashboard/members#accepting-an-invitation), or [sign up](/auth/sign-up) and create one. New organizations come with an agent that is ready to reply, so we only need a key for our server.

1. Open **[API keys](/docs/dashboard/api-keys)** and choose **Create API key**.
2. Copy the full key now. You won't see it again.

## 2. Install and configure

Install the SDK in your React app:

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

Add `POST /api/astralbeam/token` to your backend. It verifies the signed-in user and returns a short-lived `{ token }` for chat. Use stable IDs from the authenticated session for the user and their customer account, called a Tenant in AstralBeam.

Choose the example for your backend, or use the [token format](/docs/sdk/authentication#mint-tokens-without-javascript) in another language. Keep your backend's session and CSRF protections. Return an authentication error when the user has no valid session or account membership.

<!-- ::start:tabs -->

### Next.js

This App Router example uses an existing Better Auth instance at `@/lib/auth` with the organization plugin and an active organization.

```ts title="src/app/api/astralbeam/token/route.ts"
import { createAstralBeamToken } from "@astralbeam/sdk/server"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"

export async function POST(request: Request) {
  const membership = await auth.api.getActiveMember({
    headers: request.headers,
    asResponse: true,
  })
  if (!membership.ok) return membership
  const member = await membership.json()
  const token = await createAstralBeamToken({
    apiKey: process.env.ASTRALBEAM_API_KEY!,
    user: { id: member.userId },
    tenant: { id: member.organizationId },
  })
  return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } })
}
```

### Rails

Add the `jwt` gem. This example uses Rails' authentication generator and assumes each user belongs to an account.

Add a route:

```ruby title="config/routes.rb"
post "/api/astralbeam/token", to: "astralbeam_tokens#create"
```

```ruby title="app/controllers/astralbeam_tokens_controller.rb"
require "jwt"
require "digest"
require "base64"

class AstralbeamTokensController < ApplicationController
  before_action :require_authentication

  def create
    key_id, issuer, signing_secret = get_signing_secret
    claims = {
      ver: 4, iss: issuer, aud: "astralbeam",
      iat: Time.current.to_i, exp: 5.minutes.from_now.to_i,
      user: { id: Current.user.id.to_s },
      tenant: { id: Current.user.account_id.to_s }
    }
    token = JWT.encode(
      claims, signing_secret, "HS256", { typ: "astralbeam+jwt", kid: key_id }
    )
    response.headers["Cache-Control"] = "no-store"
    render json: { token: token }
  end

  private

  def get_signing_secret
    key_id, _, secret = ENV.fetch("ASTRALBEAM_API_KEY").rpartition("_abo_")
    digest = Digest::SHA256.digest("abo_#{secret}")
    [key_id, key_id.split("_")[1], Base64.urlsafe_encode64(digest, padding: false)]
  end
end
```

Keep `csrf_meta_tags` in your Rails layout and include the CSRF header shown in the [Rails integration](/docs/sdk/script-tag#ruby-on-rails).

<!-- ::end:tabs -->

## 4. Mount and test

The SDK calls `/api/astralbeam/token` automatically. Add the chat to a container with a defined height:

```tsx title="src/Assistant.tsx"
"use client"

import { AstralBeamChat } from "@astralbeam/sdk/react"

export function Assistant() {
  return (
    <aside style={{ height: "100dvh" }}>
      <AstralBeamChat />
    </aside>
  )
}
```

Mount `<Assistant />` in your app, sign in, and send **"Say hello in one sentence."** You should see a reply stream into the chat.

For self-hosting, pass `apiUrl="https://your-deployment.example/api"` on `<AstralBeamChat>`, using the deployment that issued your API key.

If chat cannot connect, check the token endpoint in your browser's Network panel and follow [authentication troubleshooting](/docs/sdk/authentication#troubleshooting).

## Next

[Customize your setup](./customize.md) to shape your agent, control spend, and match your brand. [Add tools and widgets](/docs/sdk/tools-and-widgets) to let the assistant work with your app's data, or follow the [Todos tutorial](./todos-tutorial.md). Read the [security model](/docs/sdk/security) before connecting production actions.
