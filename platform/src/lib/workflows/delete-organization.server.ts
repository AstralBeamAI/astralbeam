import { DateTime, Duration, Effect, Schedule, Schema } from "effect"
import { SqlError } from "effect/sql"
import { Activity, Workflow } from "effect/workflow"

import { Mailer } from "../email/email.server.ts"
import {
  deleteOrganization as deleteOrganizationFn,
  deleteOrganizationThreadBatch,
  deleteOrganizationTenantBatch,
  readUserEmails,
} from "../organizations/deletion.server.ts"
import { UuidV7Schema } from "../schemas.ts"

const deleteOrganization = Workflow.make("DeleteOrganization/v2", {
  payload: {
    organizationId: UuidV7Schema,
    operationId: Schema.String,
    organizationName: Schema.String,
    ownerUserIds: Schema.Array(UuidV7Schema),
  },
  // Seeds and restores can recreate an organization under the same UUID.
  idempotencyKey: ({ organizationId, operationId }) => `${organizationId}:${operationId}`,
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
      // Effect SQL turns commit failures into defects. Purges are safe to retry after uncertain commits.
      // https://github.com/Effect-TS/effect/blob/main/packages/effect/src/sql/SqlClient.ts
      Effect.catchDefect((defect) =>
        SqlError.isSqlError(defect) ? Effect.fail(defect) : Effect.die(defect),
      ),
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

export const deleteOrganizationWorkflowLayer = deleteOrganization.toLayer((payload) =>
  Effect.gen(function* () {
    const { organizationId } = payload
    yield* purgeOrganizationStep(
      "DeleteThreads",
      drainOrganizationBatches(deleteOrganizationThreadBatch(organizationId)),
    )
    yield* purgeOrganizationStep(
      "DeleteTenants",
      drainOrganizationBatches(deleteOrganizationTenantBatch(organizationId)),
    )
    yield* purgeOrganizationStep("DeleteOrganization", deleteOrganizationFn(organizationId))
    yield* Effect.logInfo("Organization deleted", { organizationId })
    yield* Activity.make({ name: "NotifyOwners", execute: notifyOrganizationOwners(payload) })
  }),
)

export default deleteOrganization
