# Quickstart

Let's add an assistant to your **React app** using your existing login.

[![Acme Assistant beside a sample app, showing a greeting and reply.](/docs/quickstart-preview.png)](/docs/quickstart-preview.png)

You'll need an authenticated backend and a model-provider API key. Any backend language or authentication provider works. For self-hosting, complete [Deploy](/docs/self-hosting/deploy) first.

## 1. Prepare your agent

Use your existing organization, [join your team's](/docs/dashboard/members#accepting-an-invitation), or [sign up](/auth/sign-up) and create one.

1. Open **[Models](/docs/dashboard/models)**, add your provider's API key, enable a model, and choose **Save provider**.
2. Choose **Test model** and wait for **replied successfully**. Your provider may charge for the test.
3. Open **[Agents](/docs/dashboard/agents)**, assign that model to the starter agent, and choose **Save changes**.
4. Open **[API Keys](/docs/dashboard/api-keys)** and create a key. Copy the full key now. You won't see it again.

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

Your backend verifies the signed-in user, signs a short-lived JWT, and returns `{ token }` from `POST /api/astralbeam/token`. Use stable IDs from your authenticated session for the user and their customer account (`tenant`).

Here are two examples. See the [token format](/docs/sdk/authentication#mint-tokens-without-javascript) to sign tokens in another language. Keep your backend's session and CSRF protections.

<!-- ::start:tabs -->

### TypeScript

This example uses an existing Better Auth instance at `@/lib/auth`. Its organization membership maps to the customer account.

```ts title="src/server/astralbeam-token.ts"
import { createAstralBeamToken } from "@astralbeam/sdk/server"
import { auth } from "@/lib/auth"

export async function POST(request: Request) {
  const member = await auth.api.getActiveMember({ headers: request.headers })
  const token = await createAstralBeamToken({
    apiKey: process.env.ASTRALBEAM_API_KEY!,
    user: { id: member.userId },
    tenant: { id: member.organizationId },
  })
  return Response.json({ token }, { headers: { "Cache-Control": "no-store" } })
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
    no_store
    key_id, _, secret = ENV.fetch("ASTRALBEAM_API_KEY").rpartition("_abo_")
    digest = Digest::SHA256.digest("abo_#{secret}")
    signing_key = Base64.urlsafe_encode64(digest, padding: false)
    claims = {
      ver: 4, iss: key_id.split("_")[1], aud: "astralbeam",
      iat: Time.current.to_i, exp: 5.minutes.from_now.to_i,
      user: { id: Current.user.id.to_s },
      tenant: { id: Current.user.account_id.to_s }
    }
    token = JWT.encode(
      claims, signing_key, "HS256", { typ: "astralbeam+jwt", kid: key_id }
    )
    render json: { token: token }
  end
end
```

Keep `csrf_meta_tags` in your Rails layout.

<!-- ::end:tabs -->

## 4. Mount and test

Pass a function that calls your token handler:

```tsx title="src/Assistant.tsx"
"use client"

import { AstralBeamChat } from "@astralbeam/sdk/react"

async function fetchToken() {
  const csrfToken = document.querySelector<HTMLMetaElement>("meta[name=csrf-token]")?.content
  const response = await fetch("/api/astralbeam/token", {
    method: "POST",
    headers: csrfToken ? { "X-CSRF-Token": csrfToken } : {},
  })
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

For self-hosting, pass `apiUrl="https://your-deployment.example/api"` on `<AstralBeamChat>`, using the deployment that issued your API key.

See [SDK props](/docs/sdk/configuration#options) to customize the assistant.

## Next

[Add tools and widgets](/docs/sdk/tools-and-widgets), or try the [Todos tutorial](./todos-tutorial.md). Read the [security model](/docs/sdk/security) before giving tools access to your app's data.

See [Authentication](/docs/sdk/authentication) for troubleshooting.
