import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { Agents } from "@/lib/agents/agents.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"

export const getNewAgentPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(({ context, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(Agents, (agents) => agents.formOptions(context.organizationId)).pipe(
        Effect.map(({ sandboxProviders, models }) => ({
          data: { sandboxProviders, models },
          permissions: context.permissions,
        })),
      ),
      serverFnMeta.name,
    ),
  )
