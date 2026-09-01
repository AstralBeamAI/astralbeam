import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { createOrganizationAgent } from "@/db/organization-agent.server"
import { organizationConfigurationAccessMiddleware } from "@/lib/auth/organization-configuration-middleware"
import { CreateOrganizationAgentInputSchema } from "../-lib/schemas.ts"

export const createOrganizationAgentState = createServerFn({ method: "POST" })
  .middleware([organizationConfigurationAccessMiddleware("update")])
  .validator(Schema.toStandardSchemaV1(CreateOrganizationAgentInputSchema))
  .handler(({ context, data }) =>
    runDatabaseEffect(
      createOrganizationAgent({ organizationId: context.organizationId, ...data }).pipe(
        Effect.as({ ok: true as const }),
        Effect.catchTags({
          OrganizationAgentConflictError: (error) =>
            Effect.succeed({
              ok: false as const,
              code: "duplicate_slug" as const,
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
