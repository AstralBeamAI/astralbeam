import type { ListedApiKey } from "@better-auth-ui/core/plugins/api-key"

import { isValidSlug } from "../slug.ts"

export type OrganizationApiKey = ListedApiKey & { readonly slug: string }

export const ORGANIZATION_API_KEY_PREFIX = "abo_"
// Better Auth counts the prefix inside this preview length. https://better-auth.com/docs/plugins/api-key/reference#startingcharactersconfig-options
export const ORGANIZATION_API_KEY_STARTING_CHARACTERS_LENGTH = ORGANIZATION_API_KEY_PREFIX.length +
  6

export function organizationApiKeySlugFromMetadata(metadata: unknown): string | null {
  if (
    typeof metadata !== "object" || metadata === null || Array.isArray(metadata) ||
    Object.keys(metadata).length !== 1
  ) return null
  const slug = (metadata as { slug?: unknown }).slug
  return typeof slug === "string" && isValidSlug(slug) ? slug : null
}

export const ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS = 100
const ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MINUTES = 5
export const ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS =
  ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MINUTES * 60 * 1_000
