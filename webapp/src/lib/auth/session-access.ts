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

export interface SessionAccessDependencies {
  listOrganizations: () => Promise<readonly OrganizationMembershipIdentity[]>
  setActiveOrganization: (organizationId: string) => Promise<void>
}

/**
 * Reconcile the session's active organization against the user's current memberships.
 *
 * Memberships remain authoritative: a null or stale active organization does not imply
 * that the user needs onboarding. When selection is required, sorting by the opaque ID
 * makes the result independent of the order returned by the organization API.
 */
export async function reconcileSessionAccess(
  session: SessionAccessIdentity | null,
  dependencies: SessionAccessDependencies,
): Promise<SessionAccessDecision> {
  if (!session) return { status: "signed-out" }

  const organizations = await dependencies.listOrganizations()
  if (organizations.length === 0) {
    return { status: "onboarding", userId: session.userId }
  }

  const activeOrganization = session.activeOrganizationId
    ? organizations.find(({ id }) => id === session.activeOrganizationId)
    : undefined

  if (activeOrganization) {
    return {
      status: "ready",
      userId: session.userId,
      organizationId: activeOrganization.id,
      organizationSlug: activeOrganization.slug,
    }
  }

  const organization =
    organizations.toSorted((left, right) => compareOrganizationIds(left.id, right.id))[0]

  if (!organization) {
    return { status: "onboarding", userId: session.userId }
  }

  await dependencies.setActiveOrganization(organization.id)
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
