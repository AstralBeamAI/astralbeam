import { createFileRoute } from "@tanstack/react-router"

/**
 * Liveness probe `scripts/check-binary.ts` reads, so it stays reachable without a session; being
 * unauthenticated is why it answers one constant body and never reads, logs, or parses a request.
 */
export const Route = createFileRoute("/api/status")({
  server: {
    handlers: {
      GET: () => Response.json({ status: "ok" }),
    },
  },
})
