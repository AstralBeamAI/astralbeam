import { createFileRoute } from "@tanstack/react-router"

async function handleAuthRequest(request: Request): Promise<Response> {
  const { getDatabaseBootstrapIssues } = await import(
    "@/db/lib/database-credentials.server"
  )
  if (getDatabaseBootstrapIssues().length > 0) {
    return new Response("Server configuration required", { status: 503 })
  }
  const [{ getAuth }, { setupGateResponse }] = await Promise.all([
    import("@/lib/auth.server"),
    import("@/lib/config/state.server"),
  ])
  const gate = await setupGateResponse()
  if (gate) return gate
  return (await getAuth()).handler(request)
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuthRequest(request),
      POST: ({ request }) => handleAuthRequest(request),
    },
  },
})
