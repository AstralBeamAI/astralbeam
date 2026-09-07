/**
 * Organization pages live at the root of the URL space, so every other top-level path segment is
 * unavailable as a slug. `organization-slug.test.ts` checks the route tree against this list.
 */
export const RESERVED_ORGANIZATION_SLUGS = [
  ".well-known",
  "admin",
  "api",
  "assets",
  "auth",
  "configure",
  "dev",
  "docs",
  "favicon.ico",
  "invitations",
  "invite",
  "login",
  "logout",
  "new",
  "o",
  "onboarding",
  "org",
  "organization",
  "organizations",
  "public",
  "robots.txt",
  "settings",
  "sign-in",
  "sign-up",
  "sitemap.xml",
  "static",
] as const

export const RESERVED_ORGANIZATION_SLUG_MESSAGE = "Slug is reserved; choose another one"

const reservedOrganizationSlugs = new Set<string>(RESERVED_ORGANIZATION_SLUGS)

export function isReservedOrganizationSlug(value: string): boolean {
  return reservedOrganizationSlugs.has(value.toLowerCase())
}
