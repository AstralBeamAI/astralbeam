import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { deleteOrganizationAgent } from "@/db/agent.server"
import { catchOptimisticLockConflict } from "@/db/lib/optimistic-locking.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { DeleteAgentInputSchema } from "../-lib/schemas.ts"

export const deleteAgent = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["delete"] })])
  .validator(Schema.toStandardSchemaV1(DeleteAgentInputSchema))
  .handler(({ context, data }) =>
    runDatabaseEffect(
      deleteOrganizationAgent({
        organizationId: context.organizationId,
        id: data.id,
        lockVersion: data.lockVersion,
      }).pipe(
        Effect.as({ ok: true as const }),
        catchOptimisticLockConflict("Reload before deleting this agent"),
      ),
    )
  )
