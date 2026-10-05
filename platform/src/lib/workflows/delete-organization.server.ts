import { DateTime, Duration, Effect, Layer, Schedule, Schema } from "effect"
import { Activity, Workflow } from "effect/workflow"

import { Mailer } from "../email/email.server.ts"
import {
  deleteOrganizationRow,
  deleteOrganizationTenantBatch,
  readUserEmails,
} from "../organizations/deletion.server.ts"
import { UuidV7Schema } from "../schemas.ts"

const legacyDeleteOrganization = Workflow.make("DeleteOrganization/v1", {
  payload: {
    organizationId: UuidV7Schema,
    operationId: Schema.String,
    organizationName: Schema.String,
    ownerUserIds: Schema.Array(UuidV7Schema),
  },
  // Seeds and restores can recreate an organization under the same UUID.
  idempotencyKey: ({ organizationId, operationId }) => `${organizationId}:${operationId}`,
})

const deleteOrganization = Workflow.make("DeleteOrganization/v2", {
  payload: legacyDeleteOrganization.payloadSchema,
  idempotencyKey: legacyDeleteOrganization.idempotencyKey,
})

// Access is already revoked, so no user can retry a failed purge. Keep retrying.
const organizationPurgeRetry = Schedule.exponential("1 second").pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, Duration.minutes(5))),
  ),
)

function purgeOrganizationStep<E, R>(name: string, execute: Effect.Effect<unknown, E, R>) {
  return Activity.make({
    name,
    execute: execute.pipe(
      Effect.asVoid,
      Effect.tapError(() => Effect.logWarning("Organization purge step failed", { step: name })),
      Effect.retry(organizationPurgeRetry),
      Effect.orDie,
    ),
  })
}

function drainOrganizationBatches<E, R>(batch: Effect.Effect<number, E, R>) {
  return batch.pipe(Effect.repeat({ while: (deleted) => deleted > 0 }))
}

const notifyOrganizationOwners = Effect.fn("notifyOrganizationOwners")(function* (input: {
  organizationName: string
  ownerUserIds: readonly string[]
}) {
  if (input.ownerUserIds.length === 0) return
  const mailer = yield* Mailer
  const deletedAt = DateTime.toDateUtc(yield* DateTime.now)
  const emails = yield* readUserEmails(input.ownerUserIds).pipe(
    Effect.retry(organizationPurgeRetry),
    Effect.orDie,
  )
  // The Mailer logs every outcome, so a notice that still fails after its retries is dropped.
  yield* Effect.forEach(emails, (email) =>
    mailer
      .sendOrganizationDeleted({ email, organizationName: input.organizationName, deletedAt })
      .pipe(Effect.retry({ schedule: Schedule.exponential("5 seconds"), times: 4 }), Effect.ignore),
  )
})

const purgeOrganization = Effect.fn("purgeOrganization")(function* (
  payload: typeof deleteOrganization.payloadSchema.Type,
) {
  const { organizationId } = payload
  yield* purgeOrganizationStep(
    "DeleteTenants",
    drainOrganizationBatches(deleteOrganizationTenantBatch(organizationId)),
  )
  yield* purgeOrganizationStep("DeleteOrganization", deleteOrganizationRow(organizationId))
  yield* Effect.logInfo("Organization deleted", { organizationId })
  yield* Activity.make({ name: "NotifyOwners", execute: notifyOrganizationOwners(payload) })
})

export const deleteOrganizationWorkflowLayer = Layer.mergeAll(
  deleteOrganization.toLayer(purgeOrganization),
  legacyDeleteOrganization.toLayer((payload) =>
    Effect.gen(function* () {
      // Preserve v1's journal checkpoint, with user deletion now handled by Tenant cascades.
      // Keep this handler until v1 executions finish. See ./README.md#define-and-register-a-workflow.
      yield* purgeOrganizationStep("DeleteTenantUsers", Effect.void)
      yield* purgeOrganization(payload)
    }),
  ),
)

export default deleteOrganization
