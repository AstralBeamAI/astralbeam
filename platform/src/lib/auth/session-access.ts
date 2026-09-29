export type SessionAccessDecision =
  | { status: "signed-out" }
  | { status: "onboarding"; userId: string }
  | { status: "ready"; userId: string; organizationId: string; organizationSlug: string }

export interface SessionAccessIdentity {
  userId: string
  activeOrganizationId: string | null
}

export interface OrganizationMembershipIdentity {
  id: string
  slug: string
}

/**
 * Chooses the organization a session lands on, without writing it.
 *
 * Memberships remain authoritative: a null or stale active organization does not imply that the
 * user needs onboarding. Otherwise the lowest opaque ID wins, so the result is independent of the
 * order returned by the organization API. The organization layout points the session's active
 * organization at the page once it renders.
 */
export function decideSessionAccess(
  session: SessionAccessIdentity | null,
  organizations: readonly OrganizationMembershipIdentity[],
): SessionAccessDecision {
  if (!session) return { status: "signed-out" }
  const organization =
    organizations.find(({ id }) => id === session.activeOrganizationId) ??
    organizations.toSorted((left, right) => compareOrganizationIds(left.id, right.id))[0]
  if (!organization) return { status: "onboarding", userId: session.userId }
  return {
    status: "ready",
    userId: session.userId,
    organizationId: organization.id,
    organizationSlug: organization.slug,
  }
}

function compareOrganizationIds(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
