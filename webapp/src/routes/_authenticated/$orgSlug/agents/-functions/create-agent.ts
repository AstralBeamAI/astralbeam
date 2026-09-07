import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { createOrganizationAgent } from "@/db/agent.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { CreateAgentInputSchema } from "../-lib/schemas.ts"

export const createAgent = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(Schema.toStandardSchemaV1(CreateAgentInputSchema))
  .handler(({ context, data: { organizationSlug: _organizationSlug, ...fields } }) =>
    runDatabaseEffect(
      createOrganizationAgent({ organizationId: context.organizationId, ...fields }).pipe(
        Effect.as({ ok: true as const, slug: fields.slug }),
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
