import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { SandboxProviders } from "@/lib/sandboxes/providers.server"
import { toValidationSchema } from "@/lib/schemas"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"

export const getSandboxesPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(({ context, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(SandboxProviders, (providers) =>
        providers.listSummaries({ organizationId: context.organizationId }),
      ).pipe(
        Effect.map((sandboxProviders) => ({
          data: { sandboxProviders },
          permissions: context.permissions,
        })),
      ),
      serverFnMeta.name,
    ),
  )
