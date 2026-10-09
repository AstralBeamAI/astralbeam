import { createFileRoute } from "@tanstack/react-router"

import { runRouteEffect } from "@/lib/runtime/server-fn.server"
import { profileImageResponse } from "@/lib/storage/profile-response.server"

export const Route = createFileRoute("/api/files/organizations/$organizationId/logos/$fileId")({
  server: {
    handlers: {
      GET: ({ params }) =>
        runRouteEffect(profileImageResponse(params.fileId, params.organizationId)),
    },
  },
})
