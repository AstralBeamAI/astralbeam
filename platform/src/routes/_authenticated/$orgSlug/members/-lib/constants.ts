export const MEMBERS_PAGE_SIZE = 20

/** The Better Auth UI list queries the members page mounts first, which its loader seeds. */
export function membersPageQueries(organizationId: string) {
  return {
    members: { organizationId, limit: MEMBERS_PAGE_SIZE, offset: 0 },
    owners: {
      organizationId,
      filterField: "role",
      filterValue: "owner",
      filterOperator: "contains",
      limit: 1,
    },
    invitations: { organizationId },
  } as const
}
