import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { catchOptimisticLockConflict } from "@/db/lib/optimistic-locking.server"
import { deleteOrganizationSandboxProvider as deleteProviderRow } from "@/db/organization-sandbox-provider.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { SandboxProviderInputSchema } from "../-lib/schemas.ts"

export const deleteSandboxProvider = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["delete"] })])
  .validator(Schema.toStandardSchemaV1(SandboxProviderInputSchema))
  .handler(({ context, data }) =>
    runDatabaseEffect(
      deleteProviderRow({
        organizationId: context.organizationId,
        id: data.id,
        lockVersion: data.lockVersion,
      }).pipe(
        Effect.as({ ok: true as const }),
        catchOptimisticLockConflict("Reload before deleting this sandbox provider"),
        Effect.catchTag("SandboxProviderInUseError", (error) =>
          Effect.succeed({
            ok: false as const,
            code: "in_use" as const,
            message: error.message,
          })),
      ),
    )
  )
