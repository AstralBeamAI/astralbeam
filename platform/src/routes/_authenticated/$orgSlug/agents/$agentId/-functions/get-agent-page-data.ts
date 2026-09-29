import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { Agents } from "@/lib/agents/agents.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { AgentIdInputSchema } from "../../-lib/schemas.ts"

/** Null when this organization has no such agent, which the loader turns into a 404 page. */
export const getAgentPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toValidationSchema(AgentIdInputSchema))
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const agents = yield* Agents
        const [agent, { sandboxProviders, defaultAgentId }] = yield* Effect.all(
          [
            agents.get({ organizationId: context.organizationId, agentId: data.agentId }),
            agents.formOptions(context.organizationId),
          ],
          { concurrency: "unbounded" },
        )
        return {
          data: { agent, sandboxProviders, isDefault: agent.id === defaultAgentId },
          permissions: context.permissions,
        }
      }).pipe(Effect.catchTag("AgentNotFound", () => Effect.succeed(null))),
      serverFnMeta.name,
    ),
  )
