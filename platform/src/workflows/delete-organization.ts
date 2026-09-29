import { Duration, Effect, Schedule, Schema } from "effect"
import { Activity, Workflow } from "effect/unstable/workflow"

import {
  deleteOrganizationRow,
  deleteOrganizationTenantBatch,
  deleteOrganizationTenantUserBatch,
  readUserEmails,
} from "../db/organization-deletion.server.ts"
import { UuidV7Schema } from "../lib/schemas.ts"

const deleteOrganization = Workflow.make("DeleteOrganization/v1", {
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
      Effect.tapError(() => Effect.logWarning("Organization purge step failed", { step: name })),
      Effect.retry(organizationPurgeRetry),
      Effect.orDie,
    ),
  })
}

function drainOrganizationBatches<E, R>(batch: Effect.Effect<number, E, R>) {
  return batch.pipe(Effect.repeat({ while: (deleted) => deleted > 0 }))
}

function notifyOrganizationOwners(input: {
  organizationName: string
  ownerUserIds: readonly string[]
}) {
  return Effect.gen(function* () {
    if (input.ownerUserIds.length === 0) return
    // Loaded on execution because Nitro's prerender bundle cannot resolve the email aliases.
    const { sendOrganizationDeletedEmail } = yield* Effect.promise(
      () => import("../emails/index.ts"),
    )
    const deletedAt = new Date()
    const emails = yield* readUserEmails(input.ownerUserIds).pipe(
      Effect.retry(organizationPurgeRetry),
      Effect.orDie,
    )
    yield* Effect.forEach(emails, (email) =>
      Effect.tryPromise(() =>
        sendOrganizationDeletedEmail({
          email,
          organizationName: input.organizationName,
          deletedAt,
        }),
      ).pipe(
        Effect.retry({ schedule: Schedule.exponential("5 seconds"), times: 4 }),
        Effect.ignore,
      ),
    )
  })
}

export const deleteOrganizationWorkflowLayer = deleteOrganization.toLayer((payload) =>
  Effect.gen(function* () {
    const { organizationId } = payload
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
    yield* Activity.make({ name: "NotifyOwners", execute: notifyOrganizationOwners(payload) })
  }),
)

export default deleteOrganization
