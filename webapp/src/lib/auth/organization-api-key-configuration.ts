import type { ListedApiKey } from "@better-auth-ui/core/plugins/api-key"

export type OrganizationApiKey = ListedApiKey & { readonly slug: string }

export const ORGANIZATION_API_KEY_PREFIX = "abo_"
// Better Auth counts the prefix inside this preview length. https://better-auth.com/docs/plugins/api-key/reference#startingcharactersconfig-options
export const ORGANIZATION_API_KEY_STARTING_CHARACTERS_LENGTH = ORGANIZATION_API_KEY_PREFIX.length +
  6

export const ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS = 100
const ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MINUTES = 5
export const ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS =
  ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MINUTES * 60 * 1_000
