import { Effect, Schedule, Schema } from "effect"
import { Activity, Workflow } from "effect/unstable/workflow"

import {
  deleteOrganizationRow,
  deleteOrganizationTenantBatch,
  deleteOrganizationTenantUserBatch,
} from "../db/organization-deletion.server.ts"
import { UuidV7Schema } from "../lib/schemas.ts"

const deleteOrganization = Workflow.make("DeleteOrganization/v1", {
  payload: { organizationId: UuidV7Schema, operationId: Schema.String },
  // Seeds and restores can recreate an organization under the same UUID.
  idempotencyKey: ({ organizationId, operationId }) => `${organizationId}:${operationId}`,
})

function purgeOrganizationStep<E, R>(name: string, execute: Effect.Effect<unknown, E, R>) {
  return Activity.make({
    name,
    execute: execute.pipe(
      Effect.asVoid,
      Effect.retry({ schedule: Schedule.exponential("1 second"), times: 6 }),
      Effect.orDie,
    ),
  })
}

function drainOrganizationBatches<E, R>(batch: Effect.Effect<number, E, R>) {
  return batch.pipe(Effect.repeat({ while: (deleted) => deleted > 0 }))
}

export const deleteOrganizationWorkflowLayer = deleteOrganization.toLayer(({ organizationId }) =>
  Effect.gen(function* () {
    yield* purgeOrganizationStep(
      "DeleteTenantUsers",
      drainOrganizationBatches(deleteOrganizationTenantUserBatch(organizationId)),
    )
    yield* purgeOrganizationStep(
      "DeleteTenants",
      drainOrganizationBatches(deleteOrganizationTenantBatch(organizationId)),
    )
    yield* purgeOrganizationStep("DeleteOrganization", deleteOrganizationRow(organizationId))
    yield* Effect.logInfo("Organization deleted", { organizationId })
  }),
)

export default deleteOrganization
