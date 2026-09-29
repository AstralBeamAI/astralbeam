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

/** How much of a stored key may leave the server, which is what names it without revealing it. */
const OPENAI_API_KEY_HINT_LENGTH = 4

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

/**
 * The chat endpoint's read: the key every run for this organization streams on, or `null`. A key
 * that does not decrypt, or was encrypted for another organization, fails typed, never as plaintext.
 */
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

/**
 * The settings page's read: the stored key's last four characters, or `null` when none is stored.
 *
 * Derived from the one stored copy rather than saved beside it, so the hint cannot drift from the
 * key, and the key itself never leaves the server.
 */
export function readOrganizationOpenaiApiKeyHint(organizationId: string) {
  return Effect.map(readOrganizationOpenaiApiKey(organizationId), (apiKey) =>
    apiKey === null ? null : apiKey.slice(-OPENAI_API_KEY_HINT_LENGTH),
  )
}

/** Replaces or clears the key, creating the configuration row on demand. */
export function writeOrganizationOpenaiApiKey(input: {
  organizationId: string
  apiKey: string | null
}) {
  const openaiApiKey =
    input.apiKey === null ? null : { organizationId: input.organizationId, apiKey: input.apiKey }
  return Effect.flatMap(Database, (db) =>
    db
      .insert(organizationConfiguration)
      .values({
        organizationId: input.organizationId,
        openaiApiKey,
      })
      .onConflictDoUpdate({
        target: organizationConfiguration.organizationId,
        set: {
          openaiApiKey,
          lockVersion: sql`${organizationConfiguration.lockVersion} + 1`,
          // Drizzle's `updatedAt` hook runs for update statements, not for a conflict clause.
          updatedAt: sql`now()`,
        },
      }),
  )
}
