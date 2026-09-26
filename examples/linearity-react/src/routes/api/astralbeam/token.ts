import process from "node:process"
import { createAstralBeamToken } from "@astralbeam/sdk/server"
import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { demoWorkspaces } from "@/lib/model.ts"

const identitySchema = z.object({ workspaceId: z.uuid(), visitorId: z.uuid() }).strict()
const headers = { "Cache-Control": "private, no-store" }
export const Route = createFileRoute("/api/astralbeam/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (
          request.headers.get("sec-fetch-site") === "cross-site" ||
          (request.headers.has("origin") &&
            request.headers.get("origin") !==
              (process.env.APP_ORIGIN || new URL(request.url).origin))
        ) {
          return Response.json(
            { error: "Cross-origin requests are not allowed" },
            { status: 403, headers },
          )
        }
        let identity
        try {
          identity = identitySchema.parse(await request.json())
        } catch {
          return Response.json({ error: "Choose a valid demo workspace" }, { status: 400, headers })
        }
        const workspace = demoWorkspaces.find((entry) => entry.id === identity.workspaceId)
        if (!workspace)
          return Response.json({ error: "Unknown demo workspace" }, { status: 400, headers })
        const apiKey = process.env.ASTRALBEAM_API_KEY
        if (!apiKey)
          return Response.json(
            { error: "Set ASTRALBEAM_API_KEY on the Linearity server to connect Astro" },
            { status: 503, headers },
          )
        try {
          const token = await createAstralBeamToken({
            apiKey,
            user: { id: identity.visitorId, name: "Avery Chen" },
            tenant: {
              id: `linearity:${identity.visitorId}:${workspace.id}`,
              name: `${workspace.name} playground`,
            },
          })
          return Response.json({ token }, { headers })
        } catch {
          return Response.json(
            { error: "Astro could not be connected. Check the server's API key." },
            { status: 500, headers },
          )
        }
      },
    },
  },
})
