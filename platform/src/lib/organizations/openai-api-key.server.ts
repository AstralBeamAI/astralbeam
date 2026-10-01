import { eq, sql } from "drizzle-orm"
import { Effect, Result } from "effect"

import { Database } from "@/db/database.server"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials.server"
import { decryptDatabaseValue } from "@/db/lib/encryption.server"
import {
  organizationConfiguration,
  OrganizationOpenaiApiKeyPayloadSchema,
} from "@/db/schema/organizations.server"
import { OrganizationOpenaiApiKeyUnreadable } from "./errors.ts"

/** Whether the organization has a key, tested in SQL so the common page read decrypts nothing. */
export const readOrganizationOpenaiApiKeyConfigured = Effect.fn(
  "readOrganizationOpenaiApiKeyConfigured",
)(function* (organizationId: string) {
  const db = yield* Database
  const rows = yield* db
    .select({
      configured: sql<boolean>`${organizationConfiguration.openaiApiKey} is not null`,
    })
    .from(organizationConfiguration)
    .where(eq(organizationConfiguration.organizationId, organizationId))
    .limit(1)
  return rows[0]?.configured ?? false
})

/** Legacy chat fallback until the owner imports the key into a named provider. Unreadable or
 * cross-organization ciphertext fails typed, never as plaintext. */
export const readOrganizationOpenaiApiKey = Effect.fn("readOrganizationOpenaiApiKey")(function* (
  organizationId: string,
) {
  const db = yield* Database
  // The raw ciphertext bypasses the column codec, which can only throw on a bad value.
  const [row] = yield* db
    .select({
      organizationId: organizationConfiguration.organizationId,
      storedValue: sql<string | null>`${organizationConfiguration.openaiApiKey}::text`,
    })
    .from(organizationConfiguration)
    .where(eq(organizationConfiguration.organizationId, organizationId))
    .limit(1)
  if (!row?.storedValue) return null
  const decrypted = decryptDatabaseValue({
    storedValue: row.storedValue,
    schema: OrganizationOpenaiApiKeyPayloadSchema,
    keyring: getDatabaseEncryptionKeyring(),
  })
  // The ciphertext carries the organization it was written for, so one copied into another
  // organization's row is refused rather than spent on that organization's behalf.
  if (Result.isFailure(decrypted) || decrypted.success.value.organizationId !== organizationId) {
    return yield* new OrganizationOpenaiApiKeyUnreadable()
  }
  return decrypted.success.value.apiKey
})
