import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { catchOptimisticLockConflict } from "@/db/lib/optimistic-locking.server"
import { deleteOrganizationAgent } from "@/db/organization-agent.server"
import { organizationConfigurationAccessMiddleware } from "@/lib/auth/organization-configuration-middleware"
import { DeleteOrganizationAgentInputSchema } from "../-lib/schemas.ts"

export const deleteOrganizationAgentState = createServerFn({ method: "POST" })
  .middleware([organizationConfigurationAccessMiddleware("delete")])
  .validator(Schema.toStandardSchemaV1(DeleteOrganizationAgentInputSchema))
  .handler(({ context, data }) =>
    runDatabaseEffect(
      deleteOrganizationAgent({ organizationId: context.organizationId, ...data }).pipe(
        Effect.as({ ok: true as const }),
        catchOptimisticLockConflict("Reload before deleting this agent"),
      ),
    )
  )
