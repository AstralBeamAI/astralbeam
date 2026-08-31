export const ORGANIZATION_API_KEY_PREFIX = "org_api_key_"
// Better Auth counts the prefix inside this preview length. https://better-auth.com/docs/plugins/api-key/reference#startingcharactersconfig-options
export const ORGANIZATION_API_KEY_STARTING_CHARACTERS_LENGTH = ORGANIZATION_API_KEY_PREFIX.length +
  6

export const ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS = 100
export const ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MINUTES = 5
export const ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS =
  ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MINUTES * 60 * 1_000

export const ORGANIZATION_API_KEY_RATE_LIMIT_DESCRIPTION =
  `Rate limit: ${ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS} successful validations per key. Once reached, validations resume ${ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MINUTES} minutes after the last successful validation.`
