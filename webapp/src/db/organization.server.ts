import { and, asc, count, eq } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { effectDatabase } from "@/db"
import {
  agent,
  apiKey,
  member,
  organization,
  sandboxProvider,
} from "@/db/schema/organizations.server"
import { SlugSchema, UuidV7Schema } from "@/lib/schemas"

const OrganizationMembershipSchema = Schema.Struct({
  organizationId: UuidV7Schema,
  organizationSlug: SlugSchema,
  organizationName: Schema.String,
  role: Schema.String,
})

const decodeOrganizationMembership = Schema.decodeUnknownEffect(
  OrganizationMembershipSchema,
  { onExcessProperty: "error" },
)

/**
 * Turns a URL slug into the organization the signed-in user actually belongs to, or `null`.
 * Better Auth's `member` has no `(organization_id, user_id)` uniqueness, so the order is explicit.
 */
export function readOrganizationMembership(input: { organizationSlug: string; userId: string }) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const rows = yield* db
      .select({
        organizationId: organization.id,
        organizationSlug: organization.slug,
        organizationName: organization.name,
        role: member.role,
      })
      .from(organization)
      .innerJoin(
        member,
        and(eq(member.organizationId, organization.id), eq(member.userId, input.userId)),
      )
      .where(eq(organization.slug, input.organizationSlug))
      .orderBy(asc(member.id))
      .limit(1)
      .pipe(Effect.orDie)
    const row = rows[0]
    if (!row) return null
    return yield* decodeOrganizationMembership(row).pipe(Effect.orDie)
  })
}

export interface OrganizationResourceCounts {
  readonly agents: number
  readonly sandboxProviders: number
  readonly apiKeys: number
  readonly members: number
}

type OrganizationOwnedTable = typeof agent | typeof apiKey | typeof member | typeof sandboxProvider

/** The dashboard's one read: how much of each resource the organization has configured. */
export function readOrganizationResourceCounts(organizationId: string) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const countRows = (table: OrganizationOwnedTable) =>
      db.select({ value: count() }).from(table).where(eq(table.organizationId, organizationId))
        .pipe(Effect.map((rows) => rows[0]?.value ?? 0), Effect.orDie)

    const [agents, sandboxProviders, apiKeys, members] = yield* Effect.all([
      countRows(agent),
      countRows(sandboxProvider),
      countRows(apiKey),
      countRows(member),
    ])
    return { agents, sandboxProviders, apiKeys, members } satisfies OrganizationResourceCounts
  })
}
