import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { Agents } from "@/lib/agents/agents.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { UpdateAgentInputSchema } from "../-lib/schemas.ts"

export const updateAgent = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(toValidationSchema(UpdateAgentInputSchema))
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(Agents, (agents) =>
        agents.update({
          organizationId: context.organizationId,
          agentId: data.agentId,
          lockVersion: data.lockVersion,
          fields: data.fields,
        }),
      ).pipe(
        Effect.catchTag(
          ["AgentChanged", "AgentNameTaken", "AgentSandboxProviderInvalid"],
          exposeError,
        ),
      ),
      serverFnMeta.name,
    ),
  )
