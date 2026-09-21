import { and, eq, sql } from "drizzle-orm"
import * as Effect from "effect/Effect"

import { effectDatabase } from "@/db"
import { member, organization, user } from "@/db/schema.server"

export function withInternalProvisioningLock<A, E, R>(operation: Effect.Effect<A, E, R>) {
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

export function readInternalOwner(email: string) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const rows = yield* db.select({ id: user.id }).from(user)
      .where(eq(user.email, email)).limit(1)
    return rows[0] ?? null
  })
}

export function createInternalOwner(email: string) {
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

export function verifyInternalOwner(userId: string) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    yield* db.update(user).set({ emailVerified: true }).where(eq(user.id, userId))
  })
}

export function readInternalOrganization(input: { id?: string | undefined; slug: string }) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const rows = yield* db.select({ id: organization.id, name: organization.name }).from(
      organization,
    ).where(input.id ? eq(organization.id, input.id) : eq(organization.slug, input.slug)).limit(1)
    return rows[0] ?? null
  })
}

export function isInternalOwner(input: { organizationId: string; userId: string }) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const rows = yield* db.select({ role: member.role }).from(member).where(
      and(eq(member.organizationId, input.organizationId), eq(member.userId, input.userId)),
    )
    return rows.some((row) => row.role.split(",").includes("owner"))
  })
}
