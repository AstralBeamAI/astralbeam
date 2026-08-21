import "@tanstack/react-start/server-only"

import { and, asc, count, eq, sql } from "drizzle-orm"

import { ORGANIZATION_MEMBERSHIP_LIMIT } from "@/auth/organization-policy"
import {
  assertCanAssignOrganizationAccessRole,
  assertCanUpdateOrganizationAccessRole,
  hasOrganizationRole,
} from "@/auth/organization-access-control"
import type { Database } from "@/db/database.server"
import { member, organization, organizationAccessGrant, user } from "@/db/schema.server"

type OrganizationAccessRole = "member" | "admin"

interface OrganizationActor {
  organizationId: string
  role: string
  userId: string
}

interface AddOrganizationAccessInput {
  email: string
  requestedRole: OrganizationAccessRole
}

function assertCanManageAccess(actor: OrganizationActor) {
  if (
    !hasOrganizationRole(actor.role, "owner") &&
    !hasOrganizationRole(actor.role, "admin")
  ) {
    throw new Error("Only organization owners and admins can manage access")
  }
}

export async function activatePendingOrganizationAccess(
  database: Database,
  createdUser: { email: string; emailVerified: boolean; id: string },
) {
  if (!createdUser.emailVerified) return 0

  const pendingGrants = await database
    .select({
      id: organizationAccessGrant.id,
      organizationId: organizationAccessGrant.organizationId,
      requestedRole: organizationAccessGrant.requestedRole,
    })
    .from(organizationAccessGrant)
    .where(
      and(
        eq(organizationAccessGrant.email, createdUser.email),
        eq(organizationAccessGrant.status, "pending"),
      ),
    )

  const activatedAt = new Date()

  let activatedCount = 0

  for (const grant of pendingGrants) {
    const activated = await database.transaction(async (transaction) => {
      await transaction
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, grant.organizationId))
        .for("update")

      const [pendingGrant] = await transaction
        .select({ requestedRole: organizationAccessGrant.requestedRole })
        .from(organizationAccessGrant)
        .where(
          and(
            eq(organizationAccessGrant.id, grant.id),
            eq(organizationAccessGrant.status, "pending"),
          ),
        )
        .for("update")

      if (!pendingGrant) return false

      const [existingMembership] = await transaction
        .select({ id: member.id, role: member.role })
        .from(member)
        .where(
          and(
            eq(member.organizationId, grant.organizationId),
            eq(member.userId, createdUser.id),
          ),
        )
        .limit(1)
        .for("update")

      if (!existingMembership) {
        const [membershipCount] = await transaction
          .select({ value: count() })
          .from(member)
          .where(eq(member.organizationId, grant.organizationId))

        if ((membershipCount?.value ?? 0) >= ORGANIZATION_MEMBERSHIP_LIMIT) return false

        await transaction
          .insert(member)
          .values({
            organizationId: grant.organizationId,
            userId: createdUser.id,
            role: pendingGrant.requestedRole,
            createdAt: activatedAt,
          })
          .onConflictDoNothing({ target: [member.organizationId, member.userId] })
      } else {
        if (hasOrganizationRole(existingMembership.role, "owner")) return false
        if (
          hasOrganizationRole(existingMembership.role, "admin") &&
          pendingGrant.requestedRole === "member"
        ) {
          return false
        }

        await transaction
          .update(member)
          .set({ role: pendingGrant.requestedRole })
          .where(eq(member.id, existingMembership.id))
      }

      const [updatedGrant] = await transaction
        .update(organizationAccessGrant)
        .set({
          activatedAt,
          activatedUserId: createdUser.id,
          status: "active",
          updatedAt: activatedAt,
        })
        .where(
          and(
            eq(organizationAccessGrant.id, grant.id),
            eq(organizationAccessGrant.status, "pending"),
          ),
        )
        .returning({ id: organizationAccessGrant.id })

      if (!updatedGrant) throw new Error("Pending access grant changed while activating")
      return true
    })

    if (activated) activatedCount += 1
  }

  return activatedCount
}

/** @knipignore Dynamically imported by organization-access.functions.ts. */
export async function addOrganizationAccess(
  database: Database,
  actor: OrganizationActor,
  input: AddOrganizationAccessInput,
) {
  assertCanAssignOrganizationAccessRole(actor.role, input.requestedRole)

  const [existingUser] = await database
    .select({ emailVerified: user.emailVerified, id: user.id })
    .from(user)
    .where(eq(user.email, input.email))
    .limit(1)

  function addVerifiedUserAccess(existingVerifiedUser: { id: string }) {
    return database.transaction(async (transaction) => {
      await transaction
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, actor.organizationId))
        .for("update")

      const [existingMember] = await transaction
        .select({ id: member.id, role: member.role })
        .from(member)
        .where(
          and(
            eq(member.organizationId, actor.organizationId),
            eq(member.userId, existingVerifiedUser.id),
          ),
        )
        .limit(1)
        .for("update")

      if (!existingMember) {
        const [membershipCount] = await transaction
          .select({ value: count() })
          .from(member)
          .where(eq(member.organizationId, actor.organizationId))

        if ((membershipCount?.value ?? 0) >= ORGANIZATION_MEMBERSHIP_LIMIT) {
          throw new Error("The organization has reached its membership limit")
        }

        await transaction.insert(member).values({
          organizationId: actor.organizationId,
          userId: existingVerifiedUser.id,
          role: input.requestedRole,
          createdAt: new Date(),
        })
      } else {
        assertCanUpdateOrganizationAccessRole(
          actor.role,
          existingMember.role,
          input.requestedRole,
        )

        if (existingMember.role !== input.requestedRole) {
          await transaction
            .update(member)
            .set({ role: input.requestedRole })
            .where(eq(member.id, existingMember.id))
        }
      }

      const now = new Date()
      const [grant] = await transaction
        .insert(organizationAccessGrant)
        .values({
          organizationId: actor.organizationId,
          email: input.email,
          requestedRole: input.requestedRole,
          status: "active",
          activatedUserId: existingVerifiedUser.id,
          createdByUserId: actor.userId,
          activatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            organizationAccessGrant.organizationId,
            organizationAccessGrant.email,
          ],
          targetWhere: sql`${organizationAccessGrant.status} <> 'revoked'`,
          set: {
            activatedAt: now,
            activatedUserId: existingVerifiedUser.id,
            requestedRole: input.requestedRole,
            status: "active",
            updatedAt: now,
          },
          ...(hasOrganizationRole(actor.role, "owner")
            ? {}
            : { setWhere: eq(organizationAccessGrant.requestedRole, "member") }),
        })
        .returning()

      if (!grant) throw new Error("Organization access grant not found")
      return {
        grant,
        result: existingMember
          ? existingMember.role === input.requestedRole ? "already-member" : "updated"
          : "added",
      } as const
    })
  }

  if (existingUser?.emailVerified) return addVerifiedUserAccess(existingUser)

  const [grant] = await database
    .insert(organizationAccessGrant)
    .values({
      organizationId: actor.organizationId,
      email: input.email,
      requestedRole: input.requestedRole,
      createdByUserId: actor.userId,
    })
    .onConflictDoUpdate({
      target: [
        organizationAccessGrant.organizationId,
        organizationAccessGrant.email,
      ],
      targetWhere: sql`${organizationAccessGrant.status} <> 'revoked'`,
      set: {
        requestedRole: input.requestedRole,
        updatedAt: new Date(),
      },
      ...(hasOrganizationRole(actor.role, "owner")
        ? {}
        : { setWhere: eq(organizationAccessGrant.requestedRole, "member") }),
    })
    .returning()

  if (!grant) throw new Error("Pending access grant not found")

  // Under Read Committed, recheck after the grant is visible so a concurrent signup cannot finish its activation hooks before the pending row exists. https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED
  const [concurrentUser] = await database
    .select({ emailVerified: user.emailVerified, id: user.id })
    .from(user)
    .where(eq(user.email, input.email))
    .limit(1)

  if (concurrentUser?.emailVerified) return addVerifiedUserAccess(concurrentUser)
  return { grant, result: "pending" } as const
}

/** @knipignore Dynamically imported by organization-access.functions.ts. */
export function listPendingOrganizationAccess(
  database: Database,
  actor: OrganizationActor,
) {
  assertCanManageAccess(actor)

  return database
    .select({
      createdAt: organizationAccessGrant.createdAt,
      createdByName: user.name,
      email: organizationAccessGrant.email,
      id: organizationAccessGrant.id,
      requestedRole: organizationAccessGrant.requestedRole,
    })
    .from(organizationAccessGrant)
    .innerJoin(user, eq(organizationAccessGrant.createdByUserId, user.id))
    .where(
      and(
        eq(organizationAccessGrant.organizationId, actor.organizationId),
        eq(organizationAccessGrant.status, "pending"),
      ),
    )
    .orderBy(asc(organizationAccessGrant.createdAt))
}

/** @knipignore Dynamically imported by organization-access.functions.ts. */
export async function updatePendingOrganizationAccessRole(
  database: Database,
  actor: OrganizationActor,
  input: { grantId: string; requestedRole: OrganizationAccessRole },
) {
  assertCanAssignOrganizationAccessRole(actor.role, input.requestedRole)
  const roleConstraint = hasOrganizationRole(actor.role, "owner")
    ? undefined
    : eq(organizationAccessGrant.requestedRole, "member")

  const [grant] = await database
    .update(organizationAccessGrant)
    .set({ requestedRole: input.requestedRole, updatedAt: new Date() })
    .where(
      and(
        eq(organizationAccessGrant.id, input.grantId),
        eq(organizationAccessGrant.organizationId, actor.organizationId),
        eq(organizationAccessGrant.status, "pending"),
        roleConstraint,
      ),
    )
    .returning()

  if (!grant) throw new Error("Pending access grant not found")
  return grant
}

/** @knipignore Dynamically imported by organization-access.functions.ts. */
export async function revokePendingOrganizationAccess(
  database: Database,
  actor: OrganizationActor,
  input: { grantId: string },
) {
  assertCanManageAccess(actor)
  const now = new Date()
  const roleConstraint = hasOrganizationRole(actor.role, "owner")
    ? undefined
    : eq(organizationAccessGrant.requestedRole, "member")

  const [grant] = await database
    .update(organizationAccessGrant)
    .set({ revokedAt: now, status: "revoked", updatedAt: now })
    .where(
      and(
        eq(organizationAccessGrant.id, input.grantId),
        eq(organizationAccessGrant.organizationId, actor.organizationId),
        eq(organizationAccessGrant.status, "pending"),
        roleConstraint,
      ),
    )
    .returning()

  if (!grant) throw new Error("Pending access grant not found")
  return grant
}
