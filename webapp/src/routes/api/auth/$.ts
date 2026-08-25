import { createFileRoute } from "@tanstack/react-router"
import { auth } from "@/lib/auth.server"

function handle({ request }: { request: Request }) {
  return auth.handler(request)
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
})
