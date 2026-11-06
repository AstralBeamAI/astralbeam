import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { ModelProviders } from "@/lib/model-providers/model-providers.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"
import { effectHandler } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"

export const getModelsPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(
    effectHandler(({ context }) =>
      Effect.gen(function* () {
        const providers = yield* ModelProviders
        const modelProviders = yield* providers.list({ organizationId: context.organizationId })
        return { data: { modelProviders }, permissions: context.permissions }
      }),
    ),
  )
