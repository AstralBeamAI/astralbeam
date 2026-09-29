import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { Agents } from "@/lib/agents/agents.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { OrganizationSlugInputSchema } from "../-lib/schemas.ts"

export const getAgentsPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toValidationSchema(OrganizationSlugInputSchema))
  .handler(({ context, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(Agents, (agents) => agents.list(context.organizationId)).pipe(
        Effect.map((data) => ({ data, permissions: context.permissions })),
      ),
      serverFnMeta.name,
    ),
  )
