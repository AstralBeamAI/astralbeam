import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { Agents } from "@/lib/agents/agents.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { effectHandler, exposeError } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { AgentIdInputSchema } from "../-lib/schemas.ts"

export const setDefaultAgent = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(toValidationSchema(AgentIdInputSchema))
  .handler(
    effectHandler(({ context, data }) =>
      Effect.flatMap(Agents, (agents) =>
        agents.setDefault({ organizationId: context.organizationId, agentId: data.agentId }),
      ).pipe(Effect.catchTag("AgentNotFound", exposeError)),
    ),
  )
