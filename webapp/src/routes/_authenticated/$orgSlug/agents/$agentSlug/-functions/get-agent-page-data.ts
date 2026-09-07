import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { readOrganizationAgentBySlug, readOrganizationAgentFormOptions } from "@/db/agent.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { AgentSlugInputSchema } from "../../-lib/schemas.ts"

export const getAgentPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(Schema.toStandardSchemaV1(AgentSlugInputSchema))
  .handler(({ context, data }) =>
    runDatabaseEffect(
      Effect.gen(function* () {
        const agent = yield* readOrganizationAgentBySlug({
          organizationId: context.organizationId,
          slug: data.agentSlug,
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
    )
  )
