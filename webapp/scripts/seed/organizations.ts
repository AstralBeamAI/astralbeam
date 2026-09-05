import { and, eq, sql } from "drizzle-orm"

import { invitation, member, organization } from "../../src/db/schema.server.ts"

import type { SeedTransaction } from "./database.ts"
import { SEED_ORGANIZATIONS } from "./fixtures.ts"

/** Better Auth's own invitation lifetime, so a seeded invitation looks like an emailed one. */
const SEED_INVITATION_EXPIRY_HOURS = 48

/**
 * Creates the organizations and their memberships.
 *
 * `member` and `invitation` keep Better Auth's generated shape, which has no unique constraint to
 * upsert against, so each row is looked up before it is written. Every organization is created
 * without its starter agent; `seedAgents` owns agents so an agent change touches one file.
 */
export async function seedOrganizations(
  transaction: SeedTransaction,
  userIdsByEmail: ReadonlyMap<string, string>,
): Promise<Map<string, string>> {
  const organizationIdsBySlug = new Map<string, string>()
  for (const seedOrganization of SEED_ORGANIZATIONS) {
    const [inserted] = await transaction
      .insert(organization)
      .values({ slug: seedOrganization.slug, name: seedOrganization.name })
      .onConflictDoUpdate({
        target: organization.slug,
        set: { name: seedOrganization.name, updatedAt: sql`now()` },
      })
      .returning({ id: organization.id })
    if (!inserted) {
      throw new Error(`PostgreSQL did not return a row for organization '${seedOrganization.slug}'`)
    }
    const organizationId = inserted.id
    organizationIdsBySlug.set(seedOrganization.slug, organizationId)

    for (const seedMember of seedOrganization.members) {
      const userId = requireSeedUserId(userIdsByEmail, seedMember.email)
      const [existing] = await transaction
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
        .limit(1)
      if (existing) {
        await transaction.update(member).set({ role: seedMember.role }).where(
          eq(member.id, existing.id),
        )
        continue
      }
      await transaction.insert(member).values({ organizationId, userId, role: seedMember.role })
    }

    const inviterEmail = seedOrganization.members.find((candidate) => candidate.role === "owner")
      ?.email
    for (const seedInvitation of seedOrganization.invitations) {
      if (!inviterEmail) {
        throw new Error(`Organization '${seedOrganization.slug}' needs an owner to invite members`)
      }
      const inviterId = requireSeedUserId(userIdsByEmail, inviterEmail)
      const expiresAt = new Date(Date.now() + SEED_INVITATION_EXPIRY_HOURS * 60 * 60 * 1_000)
      const [existing] = await transaction
        .select({ id: invitation.id })
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, organizationId),
            eq(invitation.email, seedInvitation.email),
          ),
        )
        .limit(1)
      if (existing) {
        await transaction
          .update(invitation)
          .set({ role: seedInvitation.role, status: "pending", expiresAt, inviterId })
          .where(eq(invitation.id, existing.id))
        continue
      }
      await transaction.insert(invitation).values({
        organizationId,
        email: seedInvitation.email,
        role: seedInvitation.role,
        status: "pending",
        expiresAt,
        inviterId,
      })
    }
  }
  return organizationIdsBySlug
}

function requireSeedUserId(userIdsByEmail: ReadonlyMap<string, string>, email: string): string {
  const userId = userIdsByEmail.get(email)
  if (!userId) throw new Error(`Seed user '${email}' is missing from SEED_USERS`)
  return userId
}
