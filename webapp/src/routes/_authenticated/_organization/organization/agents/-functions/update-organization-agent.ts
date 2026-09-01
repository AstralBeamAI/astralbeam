import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { catchOptimisticLockConflict } from "@/db/lib/optimistic-locking.server"
import { updateOrganizationAgent } from "@/db/agent.server"
import { organizationConfigurationAccessMiddleware } from "@/lib/auth/organization-configuration-middleware"
import { UpdateOrganizationAgentInputSchema } from "../-lib/schemas.ts"

export const updateOrganizationAgentState = createServerFn({ method: "POST" })
  .middleware([organizationConfigurationAccessMiddleware("update")])
  .validator(Schema.toStandardSchemaV1(UpdateOrganizationAgentInputSchema))
  .handler(({ context, data }) =>
    runDatabaseEffect(
      updateOrganizationAgent({ organizationId: context.organizationId, ...data }).pipe(
        Effect.as({ ok: true as const }),
        catchOptimisticLockConflict("Reload before saving this agent again"),
        Effect.catchTags({
          OrganizationAgentProviderError: (error) =>
            Effect.succeed({
              ok: false as const,
              code: "invalid_provider" as const,
              message: error.message,
            }),
        }),
      ),
    )
  )
