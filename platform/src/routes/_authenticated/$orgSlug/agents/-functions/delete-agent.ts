import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { Agents } from "@/lib/agents/agents.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { AgentVersionInputSchema } from "../-lib/schemas.ts"

export const deleteAgent = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["delete"] })])
  .validator(toValidationSchema(AgentVersionInputSchema))
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(Agents, (agents) =>
        agents.remove({
          organizationId: context.organizationId,
          agentId: data.agentId,
          lockVersion: data.lockVersion,
        }),
      ).pipe(Effect.catchTag("AgentChanged", exposeError)),
      serverFnMeta.name,
    ),
  )
