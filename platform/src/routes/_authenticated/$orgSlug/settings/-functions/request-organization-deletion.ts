import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { SqlClient } from "effect/sql"

import { provideClusterWorkflowEngine } from "@/lib/cluster/runtime.server"
import { Config } from "@/lib/config/config.server"
import { revokeOrganizationAccess } from "@/lib/organizations/deletion.server"
import {
  DogfoodOrganizationProtected,
  OrganizationChanged,
  OrganizationDeletionUnavailable,
} from "@/lib/organizations/errors"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { SlugSchema } from "@/lib/organizations/slug"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema, UuidV7Schema } from "@/lib/schemas"
import deleteOrganizationWorkflow from "@/lib/workflows/delete-organization.server"

export const requestOrganizationDeletion = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organization: ["delete"] })])
  .validator(
    toValidationSchema(
      Schema.Struct({ organizationSlug: SlugSchema, organizationId: UuidV7Schema }),
    ),
  )
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const { organizationId, organizationName } = context
        // The slug may have moved to another organization since the dialog rendered.
        if (data.organizationId !== organizationId) return yield* new OrganizationChanged()
        const config = yield* Config
        if ((yield* config.get("dogfood_organization_id")) === organizationId) {
          return yield* new DogfoodOrganizationProtected()
        }
        // Commit the revocation and the purge request together. https://effect.website/docs/v4/api/effect/workflow/Workflow/
        const sql = yield* SqlClient.SqlClient
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const ownerUserIds = yield* revokeOrganizationAccess(organizationId)
              yield* deleteOrganizationWorkflow.execute(
                {
                  organizationId,
                  operationId: crypto.randomUUID(),
                  organizationName,
                  ownerUserIds,
                },
                { discard: true },
              )
            }),
          )
          .pipe(
            provideClusterWorkflowEngine,
            Effect.catchTag("ClusterUnavailableError", () =>
              Effect.fail(new OrganizationDeletionUnavailable()),
            ),
          )
      }).pipe(
        Effect.catchTag(
          [
            "OrganizationChanged",
            "DogfoodOrganizationProtected",
            "OrganizationDeletionUnavailable",
          ],
          exposeError,
        ),
      ),
      serverFnMeta.name,
    ),
  )
