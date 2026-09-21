import { and, eq, sql } from "drizzle-orm"
import * as Effect from "effect/Effect"
import { defaultKeyHasher } from "@better-auth/api-key"
import { generateRandomString } from "better-auth/crypto"

import { effectDatabase } from "@/db"
import { apiKey, member, organization, user } from "@/db/schema.server"
import { applyDatabaseConfigChangesEffect } from "@/db/config.server"
import type { OwnerOnboarding, PendingOnboarding } from "@/lib/dogfood/schema"
import {
  ORGANIZATION_API_KEY_PREFIX,
  ORGANIZATION_API_KEY_STARTING_CHARACTERS_LENGTH,
} from "@/lib/auth/organization-api-key-configuration"

/** Commit the credential and its encrypted recovery record together, including across crashes. */
export function createDogfoodCredential(pending: PendingOnboarding & { organizationId: string }) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const secret = yield* Effect.sync(() =>
      `${ORGANIZATION_API_KEY_PREFIX}${generateRandomString(64, "a-z", "A-Z")}`
    )
    const hashed = yield* Effect.tryPromise({
      try: () => defaultKeyHasher(secret),
      catch: () => ({
        _tag: "OwnerOnboardingError" as const,
        message: "Credential generation failed",
      }),
    })
    return yield* db.transaction((transaction) =>
      Effect.gen(function* () {
        const [key] = yield* transaction.insert(apiKey).values({
          organizationId: pending.organizationId,
          name: "dogfood",
          prefix: ORGANIZATION_API_KEY_PREFIX,
          start: secret.slice(0, ORGANIZATION_API_KEY_STARTING_CHARACTERS_LENGTH),
          key: hashed,
        }).returning({ id: apiKey.id })
        const recovery = {
          ...pending,
          apiKey: `key_${pending.organizationId}_${key!.id}_${secret}`,
        }
        yield* applyDatabaseConfigChangesEffect([{
          key: "dogfood_pending_setup",
          value: JSON.stringify(recovery),
        }])
        return recovery
      })
    )
  })
}

export function withDogfoodProvisioningLock<A, E, R>(operation: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const context = yield* Effect.context<R>()
    return yield* db.transaction((transaction) =>
      Effect.gen(function* () {
        const locks = yield* transaction.execute<{ acquired: boolean }>(
          sql`select pg_try_advisory_xact_lock(734028190) as acquired`,
          "objects",
        )
        const lock = locks[0]
        if (!lock?.acquired) {
          return yield* Effect.fail({
            _tag: "OwnerOnboardingError" as const,
            message: "Owner onboarding is busy. Save again shortly.",
          })
        }
        // Keep recovery commits outside the lock's ambient transaction, even when email fails.
        // https://effect.website/docs/requirements-management/services/
        return yield* Effect.setContext(operation, context)
      })
    )
  })
}

export function readDogfoodOwner(email: string) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const rows = yield* db.select({ id: user.id, emailVerified: user.emailVerified }).from(user)
      .where(eq(user.email, email)).limit(1)
    if (rows[0] && !rows[0].emailVerified) {
      return yield* Effect.fail({
        _tag: "OwnerOnboardingError" as const,
        message: "That account is not verified. Choose a different owner email.",
      })
    }
    return rows[0] ?? null
  })
}

export function createDogfoodOwner(email: string) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const [owner] = yield* db.insert(user).values({
      email,
      name: email.split("@")[0]!,
      emailVerified: true,
    }).returning({ id: user.id })
    return owner!
  })
}

export function readDogfoodOrganization(input: { id?: string | undefined; slug: string }) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const rows = yield* db.select({ id: organization.id, name: organization.name }).from(
      organization,
    ).where(input.id ? eq(organization.id, input.id) : eq(organization.slug, input.slug)).limit(1)
    return rows[0] ?? null
  })
}

export function isDogfoodOwner(input: { organizationId: string; userId: string }) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const rows = yield* db.select({ role: member.role }).from(member).where(
      and(eq(member.organizationId, input.organizationId), eq(member.userId, input.userId)),
    )
    return rows.some((row) => row.role.split(",").includes("owner"))
  })
}

export function replacePendingDogfoodOwner(pending: PendingOnboarding, input: OwnerOnboarding) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    return yield* db.transaction((transaction) =>
      Effect.gen(function* () {
        if (!pending.requiresResetEmail) {
          return yield* Effect.fail({
            _tag: "OwnerOnboardingError" as const,
            message: "Finish onboarding with the existing owner account.",
          })
        }
        const previous = yield* readDogfoodOwner(pending.email)
        const customer = yield* readDogfoodOrganization({
          id: pending.organizationId,
          slug: pending.organizationSlug,
        })
        if (
          customer && (!previous || !(yield* isDogfoodOwner({
            organizationId: customer.id,
            userId: previous.id,
          })))
        ) {
          return yield* Effect.fail({
            _tag: "OwnerOnboardingError" as const,
            message: "That organization is not owned by the pending account",
          })
        }
        if (yield* readDogfoodOwner(input.email)) {
          return yield* Effect.fail({
            _tag: "OwnerOnboardingError" as const,
            message: "Use an unused email address to replace the pending owner.",
          })
        }
        const replacement = yield* createDogfoodOwner(input.email)
        if (customer) {
          yield* transaction.update(member).set({ userId: replacement.id }).where(and(
            eq(member.organizationId, customer.id),
            eq(member.userId, previous!.id),
          ))
        }
        const updated = {
          ...pending,
          ...input,
          ...(customer ? { organizationId: customer.id } : {}),
        }
        yield* applyDatabaseConfigChangesEffect([{
          key: "dogfood_pending_setup",
          value: JSON.stringify(updated),
        }])
        return updated
      })
    )
  })
}
