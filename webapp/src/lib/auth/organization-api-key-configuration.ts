import type { ListedApiKey } from "@better-auth-ui/core/plugins/api-key"

import { isValidSlug } from "../slug.ts"

export type OrganizationApiKey = ListedApiKey & { readonly slug: string }

export const ORGANIZATION_API_KEY_PREFIX = "abo_"
export const ORGANIZATION_API_KEY_MAXIMUM_PREFIX_LENGTH = ORGANIZATION_API_KEY_PREFIX.length + 63 +
  1
// Better Auth counts the prefix inside this preview length. https://better-auth.com/docs/plugins/api-key/reference#startingcharactersconfig-options
export const ORGANIZATION_API_KEY_STARTING_CHARACTERS_LENGTH = ORGANIZATION_API_KEY_PREFIX.length +
  6

export function formatOrganizationApiKeyPrefix(slug: string): string {
  if (!isValidSlug(slug)) throw new TypeError("API key identifier is invalid")
  return `${ORGANIZATION_API_KEY_PREFIX}${slug}_`
}

export function parseOrganizationApiKeyPrefix(prefix: unknown): string | null {
  if (typeof prefix !== "string" || !prefix.endsWith("_")) return null
  const slug = prefix.slice(ORGANIZATION_API_KEY_PREFIX.length, -1)
  return prefix === `${ORGANIZATION_API_KEY_PREFIX}${slug}_` && isValidSlug(slug) ? slug : null
}

export const ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS = 100
const ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MINUTES = 5
export const ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS =
  ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MINUTES * 60 * 1_000
