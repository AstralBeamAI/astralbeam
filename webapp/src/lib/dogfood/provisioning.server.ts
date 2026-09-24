import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  applyDatabaseConfigChangesEffect,
  type DatabaseConfigState,
  getDatabaseConfigEffect,
} from "@/db/config.server"
import {
  createDogfoodCredential,
  createDogfoodOwner,
  isDogfoodOwner,
  readDogfoodOrganization,
  readDogfoodOwner,
  replacePendingDogfoodOwner,
} from "@/db/dogfood.server"
import { getAuth } from "@/lib/auth.server"
import { provisionOrganizationDefaultAgent } from "@/db/agent.server"
import { withBlockingAuthEmailDelivery } from "@/lib/auth/email-delivery.server"
import { getGlobalConfigState, invalidateGlobalConfig } from "@/lib/config/runtime.server"
import { getGlobalConfig } from "@/lib/config"
import type { ConfigValues } from "@/lib/types"
import {
  type DogfoodOnboarding,
  type OwnerOnboarding,
  type PendingOnboarding,
  PendingOwnerOnboardingJson,
} from "./schema"

export function readDogfoodOnboarding(values: ConfigValues) {
  return Effect.gen(function* () {
    const pending = values.dogfood_pending_setup
      ? yield* Schema.decodeUnknownEffect(PendingOwnerOnboardingJson)(values.dogfood_pending_setup)
      : null
    const organizationId = values.dogfood_organization_id ?? pending?.organizationId
    const customer =
      organizationId || pending
        ? yield* readDogfoodOrganization({
            id: organizationId,
            slug: pending?.organizationSlug ?? "dogfood",
          })
        : null
    return {
      email: pending?.email ?? customer?.ownerEmail ?? "",
      organizationName: customer?.name ?? pending?.organizationName ?? "dogfood",
      organizationSlug: customer?.slug ?? pending?.organizationSlug ?? "dogfood",
      organizationCreated: Boolean(organizationId || customer),
      complete: Boolean(values.dogfood_organization_id),
    } satisfies DogfoodOnboarding
  })
}

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
  return applyDatabaseConfigChangesEffect([
    {
      key: "dogfood_pending_setup",
      value: JSON.stringify(pending),
    },
  ]).pipe(Effect.tap(() => Effect.sync(invalidateGlobalConfig)))
}

function prepareOwnerOnboarding(input: OwnerOnboarding, state: DatabaseConfigState) {
  return Effect.gen(function* () {
    const stored = state.values.dogfood_pending_setup
    if (stored) {
      const pending = yield* Schema.decodeUnknownEffect(PendingOwnerOnboardingJson)(stored).pipe(
        Effect.mapError(() => ownerOnboardingFailure("Pending onboarding is invalid")),
      )
      const customer = yield* readDogfoodOrganization({
        id: pending.organizationId,
        slug: pending.organizationSlug,
      })
      if (pending.organizationId && !customer) {
        return yield* Effect.fail(
          ownerOnboardingFailure("The provisioned organization is unavailable"),
        )
      }
      if (!customer && (yield* readDogfoodOrganization({ slug: input.organizationSlug }))) {
        return yield* Effect.fail(
          ownerOnboardingFailure("That organization slug is already in use."),
        )
      }
      const updated = {
        ...input,
        organizationId: customer?.id ?? pending.organizationId,
        organizationName: customer?.name ?? input.organizationName,
        organizationSlug: customer?.slug ?? input.organizationSlug,
      }
      if (pending.email !== input.email) {
        return yield* replacePendingDogfoodOwner(pending, updated).pipe(
          Effect.tap(() => Effect.sync(invalidateGlobalConfig)),
        )
      }
      return { ...pending, ...updated }
    }
    const existing = yield* readDogfoodOwner(input.email)
    if (existing) {
      return yield* Effect.fail(
        ownerOnboardingFailure("Use an unused email address to invite the owner."),
      )
    }
    const customer = yield* readDogfoodOrganization({
      slug: input.organizationSlug,
    })
    if (customer) {
      return yield* Effect.fail(ownerOnboardingFailure("That organization slug is already in use."))
    }
    const pending: PendingOnboarding = { ...input }
    yield* savePendingOwner(pending)
    return pending
  })
}

/** Caller must hold the provisioning lock, including configuration mutations preceding this call. */
export function provisionDogfoodResources(input: OwnerOnboarding) {
  return Effect.gen(function* () {
    const state = yield* getDatabaseConfigEffect()
    if (state.values.dogfood_organization_id) return
    const config = yield* ownerProvisioningApi(
      getGlobalConfigState,
      "Application settings are unavailable",
    )
    if (
      config.issues.some(
        (issue) => issue.key !== "dogfood_organization_id" && issue.key !== "dogfood_api_key",
      )
    ) {
      return yield* Effect.fail(
        ownerOnboardingFailure("Complete the application configuration before inviting the owner"),
      )
    }
    if (
      state.rows?.some(
        (row) =>
          (row.key === "dogfood_organization_id" ||
            row.key === "dogfood_api_key" ||
            row.key === "dogfood_pending_setup") &&
          row.storageStatus === "unreadable",
      )
    ) {
      return yield* Effect.fail(
        ownerOnboardingFailure(
          "Onboarding could not be decrypted. Restore the database encryption key.",
        ),
      )
    }
    let pending = yield* prepareOwnerOnboarding(
      { ...input, email: input.email.toLowerCase() },
      state,
    )
    const auth = yield* ownerProvisioningApi(
      getAuth,
      "Save the required authentication settings before onboarding",
    )
    const existing = yield* readDogfoodOwner(pending.email)
    const owner = existing ?? (yield* createDogfoodOwner(pending.email))
    let customer: { id: string; name: string } | null = yield* readDogfoodOrganization({
      id: pending.organizationId,
      slug: pending.organizationSlug,
    })
    if (customer && !(yield* isDogfoodOwner({ organizationId: customer.id, userId: owner.id }))) {
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
        "The dogfood organization could not be created",
      )
    }
    if (!customer) {
      return yield* Effect.fail(
        ownerOnboardingFailure("The dogfood organization could not be created"),
      )
    }
    const organizationId = customer.id
    yield* savePendingOwner({ ...pending, organizationId })
    yield* provisionOrganizationDefaultAgent({ organizationId, organizationName: customer.name })
    if (!pending.apiKey) {
      pending = yield* createDogfoodCredential({ ...pending, organizationId })
      yield* Effect.sync(invalidateGlobalConfig)
    }
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
          }),
        ),
      "The owner onboarding email could not be sent. Check email settings and try again.",
    )
    yield* applyDatabaseConfigChangesEffect([
      { key: "dogfood_organization_id", value: organizationId },
      { key: "dogfood_api_key", value: pending.apiKey! },
      { key: "dogfood_pending_setup", value: null },
    ])
    yield* Effect.sync(invalidateGlobalConfig)
  })
}
