export const ORGANIZATION_API_KEY_PREFIX = "org_api_key_"
// Better Auth counts the prefix inside this preview length. https://better-auth.com/docs/plugins/api-key/reference#startingcharactersconfig-options
export const ORGANIZATION_API_KEY_STARTING_CHARACTERS_LENGTH = ORGANIZATION_API_KEY_PREFIX.length +
  6

export const ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS = 10
export const ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_HOURS = 24
export const ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS =
  ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1_000

export const ORGANIZATION_API_KEY_RATE_LIMIT_DESCRIPTION =
  `Each key allows ${ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS} successful validations, then resets after ${ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_HOURS} hours without a successful validation.`
