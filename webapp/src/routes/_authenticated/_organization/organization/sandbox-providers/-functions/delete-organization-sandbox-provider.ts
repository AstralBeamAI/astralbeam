import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { catchOptimisticLockConflict } from "@/db/lib/optimistic-locking.server"
import { deleteOrganizationSandboxProvider as deleteSandboxProvider } from "@/db/organization-sandbox-provider.server"
import { organizationConfigurationAccessMiddleware } from "@/lib/auth/organization-configuration-middleware"
import { OrganizationSandboxExistingInputSchema } from "../-lib/schemas.ts"

export const deleteOrganizationSandboxProvider = createServerFn({ method: "POST" })
  .middleware([organizationConfigurationAccessMiddleware("delete")])
  .validator(Schema.toStandardSchemaV1(OrganizationSandboxExistingInputSchema))
  .handler(({ context, data }) =>
    runDatabaseEffect(
      deleteSandboxProvider({ organizationId: context.organizationId, ...data }).pipe(
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
