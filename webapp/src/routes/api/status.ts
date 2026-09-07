import { createFileRoute } from "@tanstack/react-router"

/**
 * Liveness probe. `scripts/check-binary.ts` reads it to decide the compiled binary has booted, so
 * it must stay reachable without a session. It is unauthenticated, which is why it answers with
 * one constant body: nothing here reads the request, logs it, or parses a body.
 */
export const Route = createFileRoute("/api/status")({
  server: {
    handlers: {
      GET: () => Response.json({ status: "ok" }),
    },
  },
})
