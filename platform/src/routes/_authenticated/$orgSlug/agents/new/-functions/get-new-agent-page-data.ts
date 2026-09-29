import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { Agents } from "@/lib/agents/agents.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { OrganizationSlugInputSchema } from "../../-lib/schemas.ts"

export const getNewAgentPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(toValidationSchema(OrganizationSlugInputSchema))
  .handler(({ context, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(Agents, (agents) => agents.formOptions(context.organizationId)).pipe(
        Effect.map(({ sandboxProviders }) => ({
          data: { sandboxProviders },
          permissions: context.permissions,
        })),
      ),
      serverFnMeta.name,
    ),
  )
