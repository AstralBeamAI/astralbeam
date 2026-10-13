import { createFileRoute } from "@tanstack/react-router"
import { handleMcpBrowserRequest } from "@/lib/mcp/authorization/browser"
import { runRouteEffect } from "@/lib/runtime/server-fn.server"

export const Route = createFileRoute("/api/mcp/oauth/$")({
  server: { handlers: { GET: () => runRouteEffect(handleMcpBrowserRequest) } },
})
