import { eq, sql } from "drizzle-orm"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"

import { effectDatabase } from "@/db"
import { organizationConfiguration } from "@/db/schema/organizations.server"

class OrganizationOpenaiApiKeyError extends Data.TaggedError(
  "OrganizationOpenaiApiKeyError",
)<{ readonly message: string }> {}

/**
 * Whether the organization has a key, tested in SQL so nothing is decrypted.
 *
 * Every caller of this is a page payload, and a key is never part of one.
 */
export function readOrganizationOpenaiApiKeyConfigured(organizationId: string) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const rows = yield* db
      .select({
        configured: sql<boolean>`${organizationConfiguration.openaiApiKey} is not null`,
      })
      .from(organizationConfiguration)
      .where(eq(organizationConfiguration.organizationId, organizationId))
      .limit(1)
    return rows[0]?.configured ?? false
  })
}

/** The chat endpoint's read: the key every run for this organization streams on, or `null`. */
export function readOrganizationOpenaiApiKey(organizationId: string) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const rows = yield* db
      .select({
        organizationId: organizationConfiguration.organizationId,
        openaiApiKey: organizationConfiguration.openaiApiKey,
      })
      .from(organizationConfiguration)
      .where(eq(organizationConfiguration.organizationId, organizationId))
      .limit(1)
    const row = rows[0]
    if (!row?.openaiApiKey) return null
    // The ciphertext carries the organization it was written for, so one copied into another
    // organization's row is refused rather than spent on that organization's behalf.
    if (row.openaiApiKey.organizationId !== row.organizationId) {
      return yield* Effect.fail(
        new OrganizationOpenaiApiKeyError({
          message: "The stored OpenAI API key belongs to another organization",
        }),
      )
    }
    return row.openaiApiKey.apiKey
  })
}

/** Replaces or clears the key, creating the configuration row on demand. */
export function writeOrganizationOpenaiApiKey(
  input: { organizationId: string; apiKey: string | null },
) {
  const openaiApiKey = input.apiKey === null
    ? null
    : { organizationId: input.organizationId, apiKey: input.apiKey }
  return Effect.flatMap(effectDatabase, (db) =>
    db.insert(organizationConfiguration).values({
      organizationId: input.organizationId,
      openaiApiKey,
    }).onConflictDoUpdate({
      target: organizationConfiguration.organizationId,
      set: {
        openaiApiKey,
        lockVersion: sql`${organizationConfiguration.lockVersion} + 1`,
        // Drizzle's `updatedAt` hook runs for update statements, not for a conflict clause.
        updatedAt: sql`now()`,
      },
    }))
}
