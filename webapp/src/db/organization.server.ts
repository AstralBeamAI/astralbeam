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
import type { OrganizationPermissions } from "@/lib/auth/organization-access"
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

/** `null` where the reader's role does not permit the resource, so the payload leaks no count. */
export interface OrganizationResourceCounts {
  readonly agents: number | null
  readonly sandboxProviders: number | null
  readonly apiKeys: number | null
  readonly members: number
}

type OrganizationOwnedTable = typeof agent | typeof apiKey | typeof member | typeof sandboxProvider

/** The dashboard's one read: how much of each resource the organization has configured. */
export function readOrganizationResourceCounts(input: {
  organizationId: string
  permissions: OrganizationPermissions
}) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const countRows = (table: OrganizationOwnedTable) =>
      db.select({ value: count() }).from(table).where(
        eq(table.organizationId, input.organizationId),
      ).pipe(Effect.map((rows) => rows[0]?.value ?? 0), Effect.orDie)
    const countIf = (allowed: boolean, table: OrganizationOwnedTable) =>
      allowed ? countRows(table) : Effect.succeed(null)

    const [agents, sandboxProviders, apiKeys, members] = yield* Effect.all([
      countIf(input.permissions.readConfiguration, agent),
      countIf(input.permissions.readConfiguration, sandboxProvider),
      countIf(input.permissions.readApiKey, apiKey),
      countRows(member),
    ])
    return { agents, sandboxProviders, apiKeys, members } satisfies OrganizationResourceCounts
  })
}
