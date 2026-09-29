import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { Effect } from "effect"

import { Auth } from "@/lib/auth/auth.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { firstApiKeysPageQuery } from "../-lib/constants"

export const getApiKeysPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ apiKey: ["read"] })])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(({ context, serverFnMeta }) => {
    const headers = getRequest().headers
    return runEffect(
      Effect.flatMap(Auth, (auth) =>
        auth.api((api) =>
          api.listApiKeys({ headers, query: firstApiKeysPageQuery(context.organizationId) }),
        ),
      ).pipe(
        Effect.map((apiKeys) => ({
          data: { organizationId: context.organizationId, apiKeys },
          permissions: context.permissions,
        })),
      ),
      serverFnMeta.name,
    )
  })
