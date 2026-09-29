import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { Agents } from "@/lib/agents/agents.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { CreateAgentInputSchema } from "../-lib/schemas.ts"

/** Returns the new agent's public ID, which the caller navigates to. */
export const createAgent = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(toValidationSchema(CreateAgentInputSchema))
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(Agents, (agents) =>
        agents.create({ organizationId: context.organizationId, fields: data.fields }),
      ).pipe(Effect.catchTag(["AgentNameTaken", "AgentSandboxProviderInvalid"], exposeError)),
      serverFnMeta.name,
    ),
  )
