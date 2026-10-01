import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { ModelProviders } from "@/lib/model-providers/model-providers.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { Organizations } from "@/lib/organizations/organizations.server"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"

export const getDashboardPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware()])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(({ context, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        // Counting only what this role may read makes the serialized payload the authorization
        // boundary, rather than the cards the browser chooses to render.
        const counts = yield* Effect.flatMap(Organizations, (organizations) =>
          organizations.resourceCounts({
            organizationId: context.organizationId,
            permissions: context.permissions,
          }),
        )
        // Null where the reader's role does not permit configuration, which is also why no
        // banner appears for them.
        const modelSetup = context.permissions.readConfiguration
          ? yield* Effect.flatMap(ModelProviders, (providers) =>
              providers.setupState({ organizationId: context.organizationId }),
            )
          : null
        return {
          data: { organizationName: context.organizationName, counts, modelSetup },
          permissions: context.permissions,
        }
      }),
      serverFnMeta.name,
    ),
  )
