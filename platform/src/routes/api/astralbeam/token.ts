import { createFileRoute } from "@tanstack/react-router"

import { getDatabaseBootstrapIssues } from "@/db/lib/database-credentials.server"
import { getAppRuntime } from "@/lib/runtime/runtime.server"
import { dashboardTokenErrorResponse, handleDashboardTokenRequest } from "./-lib/token.server"

export const Route = createFileRoute("/api/astralbeam/token")({
  server: {
    handlers: {
      // Without the database variables no Effect can run.
      POST: ({ request }) =>
        getDatabaseBootstrapIssues().length > 0
          ? dashboardTokenErrorResponse("Application is not configured", 503)
          : getAppRuntime().runPromise(handleDashboardTokenRequest(request)),
    },
  },
})
