import type { ListedApiKey } from "@better-auth-ui/core/plugins/api-key"
// Seed modules and the database schema import this under a plain `deno run`, so it has no `@/` imports.
import { Schema } from "effect"

import { UUID_V7_PATTERN } from "../schemas.ts"

export type OrganizationApiKey = ListedApiKey

export const ORGANIZATION_API_KEY_PREFIX = "abo_"
export const ORGANIZATION_API_KEY_SECRET_LENGTH = 64
// Better Auth counts the prefix inside this preview length. https://better-auth.com/docs/plugins/api-key/reference#startingcharactersconfig-options
export const ORGANIZATION_API_KEY_STARTING_CHARACTERS_LENGTH =
  ORGANIZATION_API_KEY_PREFIX.length + 6
/** Better Auth's configuration ID for every organization API key. */
export const ORGANIZATION_API_KEY_CONFIG_ID = "default"
export const ORGANIZATION_API_KEY_PAGE_SIZE = 10

export const ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS = 100
const ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MINUTES = 5
export const ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS =
  ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MINUTES * 60 * 1_000

const API_KEY_ID_PATTERN = new RegExp(`^key_(${UUID_V7_PATTERN})_(${UUID_V7_PATTERN})$`)
const API_KEY_CREDENTIAL_PATTERN = new RegExp(
  `^key_(${UUID_V7_PATTERN})_(${UUID_V7_PATTERN})_(${ORGANIZATION_API_KEY_PREFIX}[A-Za-z]{${ORGANIZATION_API_KEY_SECRET_LENGTH}})$`,
)

/** The one-time `key_<organizationId>_<id>_abo_<secret>` credential an organization API key issues. */
export const ApiKeyCredentialSchema = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(API_KEY_CREDENTIAL_PATTERN, { message: "Must be a valid API key" }),
  ),
)

interface ApiKeyReference {
  readonly organizationId: string
  readonly id: string
}

/** The public `key_<organizationId>_<id>` identifier, which JWTs carry as their `kid`. */
export function formatApiKeyId(key: ApiKeyReference): string {
  return `key_${key.organizationId}_${key.id}`
}

export function formatApiKeyCredential(key: ApiKeyReference & { readonly secret: string }): string {
  return `${formatApiKeyId(key)}_${key.secret}`
}

/** A parsed organization ID identifies a key's owner, but never authorizes access to it. */
export function parseApiKeyId(value: unknown): ApiKeyReference | null {
  const match = typeof value === "string" ? API_KEY_ID_PATTERN.exec(value) : null
  return match ? { organizationId: match[1]!, id: match[2]! } : null
}

export function parseApiKeyCredential(
  value: unknown,
): (ApiKeyReference & { readonly secret: string }) | null {
  const match = typeof value === "string" ? API_KEY_CREDENTIAL_PATTERN.exec(value) : null
  return match ? { organizationId: match[1]!, id: match[2]!, secret: match[3]! } : null
}
