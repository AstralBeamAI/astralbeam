import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { Auth } from "@/lib/auth/auth.server"
import { provideClusterWorkflowEngine } from "@/lib/cluster/runtime"
import { consumeImageUpload } from "@/lib/organizations/images.server"
import { queueOrganizationLogoImport } from "@/lib/organizations/logo-import.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"
import { effectHandler, exposeError } from "@/lib/runtime/server-fn.server"
import { ServerRequest } from "@/lib/runtime/server-request.server"
import { toValidationSchema } from "@/lib/schemas"

export const refreshOrganizationLogo = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organization: ["update"] })])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(
    effectHandler(({ context }) =>
      Effect.gen(function* () {
        const session = yield* (yield* Auth).requireSession({
          headers: (yield* ServerRequest).request.headers,
        })
        yield* consumeImageUpload({ userId: session.user.id })
        yield* queueOrganizationLogoImport({ organizationId: context.organizationId })
      }).pipe(
        provideClusterWorkflowEngine,
        Effect.catchTag(["ImageUploadRateLimited", "ClusterUnavailableError"], exposeError),
      ),
    ),
  )
