import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { SqlClient } from "effect/unstable/sql"

import { provideClusterWorkflowEngine } from "@/cluster/runtime.server"
import { runDatabaseEffect } from "@/db"
import { revokeOrganizationAccess } from "@/db/organization-deletion.server"
import { getGlobalConfig } from "@/lib/config"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { toValidationSchema, SlugSchema, UuidV7Schema } from "@/lib/schemas"
import deleteOrganization from "@/workflows/delete-organization"

export const requestOrganizationDeletion = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organization: ["delete"] })])
  .validator(
    toValidationSchema(
      Schema.Struct({ organizationSlug: SlugSchema, organizationId: UuidV7Schema }),
    ),
  )
  .handler(async ({ context, data }) => {
    // The slug may have moved to another organization since the dialog rendered.
    if (data.organizationId !== context.organizationId) {
      return { ok: false as const, message: "This organization changed. Reload and try again." }
    }
    if ((await getGlobalConfig("dogfood_organization_id")) === context.organizationId) {
      return { ok: false as const, message: "This deployment's own organization cannot be deleted" }
    }
    const { organizationId, organizationName } = context
    // Commit the revocation and the purge request together. https://effect.website/docs/v4/api/effect/unstable/workflow/Workflow/
    return runDatabaseEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const ownerUserIds = yield* revokeOrganizationAccess(organizationId)
            yield* deleteOrganization.execute(
              { organizationId, operationId: crypto.randomUUID(), organizationName, ownerUserIds },
              { discard: true },
            )
          }),
        )
        return { ok: true as const }
      }).pipe(
        provideClusterWorkflowEngine,
        Effect.catchTag("ClusterUnavailableError", () =>
          Effect.succeed({
            ok: false as const,
            message: "Background jobs are unavailable. Try again shortly.",
          }),
        ),
      ),
    )
  })
