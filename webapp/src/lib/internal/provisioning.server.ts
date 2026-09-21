import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  applyDatabaseConfigChangesEffect,
  type DatabaseConfigState,
  getDatabaseConfigEffect,
} from "@/db/config.server"
import {
  createInternalOwner,
  isInternalOwner,
  readInternalOrganization,
  readInternalOwner,
  verifyInternalOwner,
} from "@/db/internal.server"
import { getAuth } from "@/lib/auth.server"
import { provisionOrganizationDefaultAgent } from "@/db/agent.server"
import { withBlockingAuthEmailDelivery } from "@/lib/auth/email-delivery.server"
import { invalidateGlobalConfig } from "@/lib/config/runtime.server"
import { getGlobalConfig } from "@/lib/config"
import { isAuthConfigured } from "@/lib/config/state.server"
import { type OwnerOnboarding, type PendingOnboarding, PendingOwnerOnboardingJson } from "./schema"

function ownerOnboardingFailure(message: string) {
  return { _tag: "OwnerOnboardingError" as const, message }
}

function ownerProvisioningApi<A>(operation: () => Promise<A>, message: string) {
  return Effect.tryPromise({
    try: operation,
    catch: () => ownerOnboardingFailure(message),
  })
}

function savePendingOwner(pending: PendingOnboarding) {
  return applyDatabaseConfigChangesEffect([{
    key: "internal_pending_setup",
    value: JSON.stringify(pending),
  }]).pipe(Effect.tap(() => Effect.sync(invalidateGlobalConfig)))
}

function prepareOwnerOnboarding(input: OwnerOnboarding, state: DatabaseConfigState) {
  return Effect.gen(function* () {
    const stored = state.values.internal_pending_setup
    if (stored) {
      const pending = yield* Schema.decodeUnknownEffect(PendingOwnerOnboardingJson)(stored).pipe(
        Effect.mapError(() => ownerOnboardingFailure("Pending onboarding is invalid")),
      )
      if (
        pending.email !== input.email ||
        (pending.organizationId &&
          (pending.organizationName !== input.organizationName ||
            pending.organizationSlug !== input.organizationSlug))
      ) {
        return yield* Effect.fail(
          ownerOnboardingFailure(
            "Finish the pending onboarding with the original owner and organization details.",
          ),
        )
      }
      return { ...pending, ...input }
    }
    const existing = yield* readInternalOwner(input.email)
    const customer = yield* readInternalOrganization({
      slug: input.organizationSlug,
    })
    if (
      customer &&
      (!existing || !(yield* isInternalOwner({ organizationId: customer.id, userId: existing.id })))
    ) {
      return yield* Effect.fail(
        ownerOnboardingFailure("That organization is not owned by the selected account"),
      )
    }
    const pending: PendingOnboarding = {
      ...input,
      requiresResetEmail: !existing,
    }
    yield* savePendingOwner(pending)
    return pending
  })
}

/** Caller must hold the provisioning lock, including configuration mutations preceding this call. */
export function provisionInternalResources(input: OwnerOnboarding) {
  return Effect.gen(function* () {
    const state = yield* getDatabaseConfigEffect()
    if (state.values.internal_organization_id) return
    if (
      !(yield* ownerProvisioningApi(isAuthConfigured, "Authentication settings are unavailable"))
    ) {
      return yield* Effect.fail(
        ownerOnboardingFailure("Complete the required authentication settings before onboarding"),
      )
    }
    if (
      state.rows?.some((row) =>
        (row.key === "internal_organization_id" || row.key === "internal_pending_setup") &&
        row.storageStatus === "unreadable"
      )
    ) {
      return yield* Effect.fail(
        ownerOnboardingFailure(
          "Onboarding could not be decrypted. Restore the database encryption key.",
        ),
      )
    }
    const pending = yield* prepareOwnerOnboarding(
      { ...input, email: input.email.toLowerCase() },
      state,
    )
    const auth = yield* ownerProvisioningApi(
      getAuth,
      "Save the required authentication settings before onboarding",
    )
    const existing = yield* readInternalOwner(pending.email)
    const owner = existing ?? (yield* createInternalOwner(pending.email))
    if (existing) yield* verifyInternalOwner(existing.id)
    let customer = yield* readInternalOrganization({
      id: pending.organizationId,
      slug: pending.organizationSlug,
    })
    if (customer && !(yield* isInternalOwner({ organizationId: customer.id, userId: owner.id }))) {
      return yield* Effect.fail(
        ownerOnboardingFailure("That organization is not owned by the selected account"),
      )
    }
    if (!customer && pending.organizationId) {
      return yield* Effect.fail(
        ownerOnboardingFailure("The provisioned organization is unavailable"),
      )
    }
    if (!customer) {
      customer = yield* ownerProvisioningApi(
        () =>
          auth.api.createOrganization({
            body: {
              name: pending.organizationName,
              slug: pending.organizationSlug,
              userId: owner.id,
            },
          }),
        "The internal organization could not be created",
      )
    }
    if (!customer) {
      return yield* Effect.fail(
        ownerOnboardingFailure("The internal organization could not be created"),
      )
    }
    const organizationId = customer.id
    yield* savePendingOwner({ ...pending, organizationId })
    yield* provisionOrganizationDefaultAgent({ organizationId, organizationName: customer.name })
    if (pending.requiresResetEmail) {
      const baseUrl = yield* ownerProvisioningApi(
        () => getGlobalConfig("app_base_url"),
        "Application URL is unavailable",
      )
      yield* ownerProvisioningApi(
        () =>
          withBlockingAuthEmailDelivery(() =>
            auth.api.requestPasswordReset({
              body: {
                email: pending.email,
                redirectTo: new URL("/auth/reset-password", baseUrl).href,
              },
            })
          ),
        "The owner onboarding email could not be sent. Check email settings and save again.",
      )
    }
    yield* applyDatabaseConfigChangesEffect([
      { key: "internal_organization_id", value: organizationId },
      { key: "internal_pending_setup", value: null },
    ])
    yield* Effect.sync(invalidateGlobalConfig)
  })
}
