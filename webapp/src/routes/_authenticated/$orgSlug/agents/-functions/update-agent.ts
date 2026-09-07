import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { updateOrganizationAgent } from "@/db/agent.server"
import { catchOptimisticLockConflict } from "@/db/lib/optimistic-locking.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { UpdateAgentInputSchema } from "../-lib/schemas.ts"

export const updateAgent = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(Schema.toStandardSchemaV1(UpdateAgentInputSchema))
  .handler(({ context, data: { organizationSlug: _organizationSlug, ...fields } }) =>
    runDatabaseEffect(
      updateOrganizationAgent({ organizationId: context.organizationId, ...fields }).pipe(
        Effect.as({ ok: true as const }),
        catchOptimisticLockConflict("Reload before saving this agent again"),
        Effect.catchTags({
          OrganizationAgentConflictError: (error) =>
            Effect.succeed({
              ok: false as const,
              code: "duplicate_name" as const,
              message: error.message,
            }),
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
