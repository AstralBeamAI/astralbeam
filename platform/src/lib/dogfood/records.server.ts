import { defaultKeyHasher } from "@better-auth/api-key"
import { generateRandomString } from "better-auth/crypto"
import { and, asc, eq, sql } from "drizzle-orm"
import { Effect } from "effect"

import { Database } from "@/db/database.server"
import { apiKey, member, organization, user } from "@/db/schema.server"
import {
  formatApiKeyCredential,
  ORGANIZATION_API_KEY_PREFIX,
  ORGANIZATION_API_KEY_SECRET_LENGTH,
  ORGANIZATION_API_KEY_STARTING_CHARACTERS_LENGTH,
} from "@/lib/api-keys/schemas"
import { Config } from "@/lib/config/config.server"
import { OwnerOnboardingFailed } from "./errors.ts"
import type { OwnerOnboarding, PendingOnboarding } from "./schemas.ts"

// Owner onboarding's database reads and writes. Each joins the caller's ambient transaction.

/** Commit the credential and its encrypted recovery record together, including across crashes. */
export const createDogfoodCredential = Effect.fnUntraced(function* (
  pending: PendingOnboarding & { organizationId: string },
) {
  const db = yield* Database
  const config = yield* Config
  const secret = `${ORGANIZATION_API_KEY_PREFIX}${generateRandomString(
    ORGANIZATION_API_KEY_SECRET_LENGTH,
    "a-z",
    "A-Z",
  )}`
  const hashed = yield* Effect.tryPromise(() => defaultKeyHasher(secret)).pipe(Effect.orDie)
  return yield* db.transaction((transaction) =>
    Effect.gen(function* () {
      const [key] = yield* transaction
        .insert(apiKey)
        .values({
          organizationId: pending.organizationId,
          name: "dogfood",
          prefix: ORGANIZATION_API_KEY_PREFIX,
          start: secret.slice(0, ORGANIZATION_API_KEY_STARTING_CHARACTERS_LENGTH),
          key: hashed,
        })
        .returning({ id: apiKey.id })
      const recovery = {
        ...pending,
        apiKey: formatApiKeyCredential({
          organizationId: pending.organizationId,
          id: key!.id,
          secret,
        }),
      }
      yield* config.write([{ key: "dogfood_pending_setup", value: JSON.stringify(recovery) }])
      return recovery
    }),
  )
})

export const readDogfoodOwner = Effect.fnUntraced(function* (email: string) {
  const db = yield* Database
  const [owner] = yield* db
    .select({ id: user.id, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
  if (owner && !owner.emailVerified) {
    return yield* new OwnerOnboardingFailed({ reason: "ownerUnverified" })
  }
  return owner ?? null
})

export const createDogfoodOwner = Effect.fnUntraced(function* (email: string) {
  const db = yield* Database
  const [owner] = yield* db
    .insert(user)
    .values({ email, name: email.split("@")[0]!, emailVerified: true })
    .returning({ id: user.id })
  return owner!
})

export const readDogfoodOrganization = Effect.fnUntraced(function* (input: {
  id?: string | undefined
  slug: string
}) {
  const db = yield* Database
  const [found] = yield* db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      ownerEmail: user.email,
    })
    .from(organization)
    .leftJoin(
      member,
      and(
        eq(member.organizationId, organization.id),
        sql`'owner' = any(string_to_array(${member.role}, ','))`,
      ),
    )
    .leftJoin(user, eq(user.id, member.userId))
    .where(input.id ? eq(organization.id, input.id) : eq(organization.slug, input.slug))
    .orderBy(asc(member.id))
    .limit(1)
  return found ?? null
})

export const isDogfoodOwner = Effect.fnUntraced(function* (input: {
  organizationId: string
  userId: string
}) {
  const db = yield* Database
  const rows = yield* db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, input.organizationId), eq(member.userId, input.userId)))
  return rows.some((row) => row.role.split(",").includes("owner"))
})

/** Moves the pending owner's membership to an unused address, keeping the organization. */
export const replacePendingDogfoodOwner = Effect.fnUntraced(function* (
  pending: PendingOnboarding,
  input: OwnerOnboarding,
) {
  const db = yield* Database
  const config = yield* Config
  return yield* db.transaction((transaction) =>
    Effect.gen(function* () {
      const previous = yield* readDogfoodOwner(pending.email)
      const customer = yield* readDogfoodOrganization({
        id: pending.organizationId,
        slug: pending.organizationSlug,
      })
      if (
        customer &&
        (!previous ||
          !(yield* isDogfoodOwner({ organizationId: customer.id, userId: previous.id })))
      ) {
        return yield* new OwnerOnboardingFailed({ reason: "organizationNotOwnedByPending" })
      }
      if (yield* readDogfoodOwner(input.email)) {
        return yield* new OwnerOnboardingFailed({ reason: "replacementEmailInUse" })
      }
      const replacement = yield* createDogfoodOwner(input.email)
      if (customer) {
        yield* transaction
          .update(member)
          .set({ userId: replacement.id })
          .where(and(eq(member.organizationId, customer.id), eq(member.userId, previous!.id)))
      }
      const updated = { ...pending, ...input, ...(customer ? { organizationId: customer.id } : {}) }
      yield* config.write([{ key: "dogfood_pending_setup", value: JSON.stringify(updated) }])
      return updated
    }),
  )
})
