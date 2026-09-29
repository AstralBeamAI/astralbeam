import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { Auth } from "@/lib/auth/auth.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { ServerRequest } from "@/lib/runtime/server-request.server"
import { toValidationSchema } from "@/lib/schemas"
import { firstApiKeysPageQuery } from "../-lib/constants"

export const getApiKeysPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ apiKey: ["read"] })])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(({ context, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const { headers } = (yield* ServerRequest).request
        const auth = yield* Auth
        const apiKeys = yield* auth.api((api) =>
          api.listApiKeys({ headers, query: firstApiKeysPageQuery(context.organizationId) }),
        )
        return {
          data: { organizationId: context.organizationId, apiKeys },
          permissions: context.permissions,
        }
      }),
      serverFnMeta.name,
    ),
  )
