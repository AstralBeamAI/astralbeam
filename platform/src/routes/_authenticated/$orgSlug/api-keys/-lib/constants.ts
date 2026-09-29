import { ORGANIZATION_API_KEY_PAGE_SIZE } from "@/lib/api-keys/schemas"

/** The query `ApiKeys` mounts first, newest keys first, which the page loader seeds. */
export function firstApiKeysPageQuery(organizationId: string) {
  return {
    limit: ORGANIZATION_API_KEY_PAGE_SIZE,
    offset: 0,
    sortBy: "createdAt",
    sortDirection: "desc",
    organizationId,
  } as const
}
