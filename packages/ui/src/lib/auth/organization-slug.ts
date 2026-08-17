export const ORGANIZATION_NAME_MAX_LENGTH = 80
export const ORGANIZATION_SLUG_MAX_LENGTH = 48
export const ORGANIZATION_SLUG_MIN_LENGTH = 2

export function sanitizeOrganizationSlug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ORGANIZATION_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "")
}
