const fence = "```"

function codeBlock(language: string, title: string, code: string) {
  return `${fence}${language} title="${title}"\n${code.trim()}\n${fence}`
}

function tabs(content: string[], variant?: "files") {
  return [
    `<!-- ::start:tabs${variant ? ` variant="${variant}"` : ""} -->`,
    ...content,
    "<!-- ::end:tabs -->",
  ].join("\n\n")
}

const tokenOptions = `
    apiKey: process.env.ASTRALBEAM_API_KEY!,
    user: { id: "test-user" }, // Replace with the signed-in user's ID
    tenant: { id: "test-org" }, // Replace with the user's account or organization ID`

/** Markdown for each guide step, naming this deployment so pasted code reaches it. */
export function integrationSnippets(apiUrl: string) {
  return {
    environment: codeBlock("env", ".env", "ASTRALBEAM_API_KEY=your_api_key"),
    install: tabs(
      [
        codeBlock("sh", "npm", "npm install @astralbeam/sdk"),
        codeBlock("sh", "pnpm", "pnpm add @astralbeam/sdk"),
        codeBlock("sh", "yarn", "yarn add @astralbeam/sdk"),
        codeBlock("sh", "bun", "bun add @astralbeam/sdk"),
      ],
      "files",
    ),
    endpoint: tabs([
      "### Next.js",
      codeBlock(
        "ts",
        "app/api/astralbeam/token/route.ts",
        `
import { createAstralBeamToken } from "@astralbeam/sdk/server"

export async function POST() {
  // The test IDs below are not authenticated, so this refuses production until you replace them
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 401 })
  const token = await createAstralBeamToken({${tokenOptions}
  })
  return Response.json({ token }, { headers: { "Cache-Control": "no-store" } })
}`,
      ),
      "### TanStack Start",
      codeBlock(
        "ts",
        "src/routes/api/astralbeam/token.ts",
        `
import { createAstralBeamToken } from "@astralbeam/sdk/server"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/astralbeam/token")({
  server: {
    handlers: {
      POST: async () => {
        // The test IDs below are not authenticated, so this refuses production until you replace them
        if (process.env.NODE_ENV === "production") return new Response(null, { status: 401 })
        const token = await createAstralBeamToken({${tokenOptions.replaceAll("\n", "\n      ")}
        })
        return Response.json({ token }, { headers: { "Cache-Control": "no-store" } })
      },
    },
  },
})`,
      ),
      "### Express",
      codeBlock(
        "ts",
        "server.ts",
        `
import { createAstralBeamToken } from "@astralbeam/sdk/server"

// Add this route to your existing Express app
app.post("/api/astralbeam/token", async (req, res) => {
  // The test IDs below are not authenticated, so this refuses production until you replace them
  if (process.env.NODE_ENV === "production") return res.sendStatus(401)
  const token = await createAstralBeamToken({${tokenOptions}
  })
  res.set("Cache-Control", "no-store").json({ token })
})`,
      ),
      "### Rails",
      codeBlock(
        "ruby",
        "config/routes.rb",
        `post "/api/astralbeam/token", to: "astralbeam_tokens#create"`,
      ),
      codeBlock(
        "ruby",
        "app/controllers/astralbeam_tokens_controller.rb",
        `
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
end`,
      ),
    ]),
    mount: tabs([
      "### React",
      codeBlock(
        "tsx",
        "src/components/sidebar.tsx",
        `
"use client"

import { AstralBeamChat } from "@astralbeam/sdk/react"

export function Sidebar() {
  return (
    <aside style={{ height: "100dvh" }}>
      <AstralBeamChat apiUrl="${apiUrl}" />
    </aside>
  )
}`,
      ),
      "### TypeScript",
      codeBlock(
        "ts",
        "src/sidebar.ts",
        `
import { mountAstralBeamChat } from "@astralbeam/sdk/client"

const container = document.getElementById("sidebar")!
container.style.height = "100dvh"
mountAstralBeamChat(container, { apiUrl: "${apiUrl}" })`,
      ),
      "### Script tag",
      codeBlock(
        "html",
        "index.html",
        `
<div id="sidebar" style="height: 100dvh"></div>
<script type="module">
  import { mountAstralBeamChat } from "https://cdn.jsdelivr.net/npm/@astralbeam/sdk@0.29.5/dist/client.js"

  mountAstralBeamChat(document.getElementById("sidebar"), { apiUrl: "${apiUrl}" })
</script>`,
      ),
    ]),
  }
}
