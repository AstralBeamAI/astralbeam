import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import { toStrictStandardSchema } from "@/lib/schemas"

import { runDatabaseEffect } from "@/db"
import { readOrganizationAgentById, readOrganizationAgentFormOptions } from "@/db/agent.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { AgentIdInputSchema } from "../../-lib/schemas.ts"

export const getAgentPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toStrictStandardSchema(AgentIdInputSchema))
  .handler(({ context, data }) =>
    runDatabaseEffect(
      Effect.gen(function* () {
        const agent = yield* readOrganizationAgentById({
          organizationId: context.organizationId,
          id: data.agentId,
        })
        if (!agent) return null
        const { sandboxProviders, defaultAgentId } = yield* readOrganizationAgentFormOptions(
          context.organizationId,
        )
        return {
          data: { agent, sandboxProviders, isDefault: agent.id === defaultAgentId },
          permissions: context.permissions,
        }
      }),
    ),
  )
