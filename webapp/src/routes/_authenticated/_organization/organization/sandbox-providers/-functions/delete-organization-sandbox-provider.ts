import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { catchOptimisticLockConflict } from "@/db/lib/optimistic-locking.server"
import { deleteOrganizationSandboxProvider as deleteSandboxProvider } from "@/db/organization-sandbox-provider.server"
import { requireOrganizationConfigurationAccess } from "@/lib/auth/organization-configuration-access.server"
import { OrganizationSandboxExistingInputSchema } from "../-lib/schemas.ts"

export const deleteOrganizationSandboxProvider = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(OrganizationSandboxExistingInputSchema))
  .handler(({ data }) =>
    runDatabaseEffect(
      Effect.gen(function* () {
        const { organizationId } = yield* requireOrganizationConfigurationAccess("delete")
        yield* deleteSandboxProvider({ organizationId, ...data })
        return { ok: true as const }
      }).pipe(catchOptimisticLockConflict("Reload before deleting this sandbox provider")),
    )
  )
