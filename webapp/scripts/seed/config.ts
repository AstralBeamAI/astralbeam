import process from "node:process"

import { sql } from "drizzle-orm"

import { configTable } from "../../src/db/schema.server.ts"

import type { SeedTransaction } from "./database.ts"
import { SEED_CONFIG_VALUES } from "./fixtures.ts"

export type SeedConfigResult = {
  readonly written: string[]
  readonly fromEnvironment: string[]
}

/**
 * Writes the configuration the application needs before it will serve anything but `/configure`.
 *
 * A key whose uppercase environment variable is already set is left alone, because
 * `src/lib/config/registry.server.ts` gives the environment precedence and `/configure` renders
 * those fields read-only; writing a row for one would be invisible and misleading. Values are
 * upserted through the same encrypted-column codec `src/db/config.server.ts` uses.
 */
export async function seedConfig(transaction: SeedTransaction): Promise<SeedConfigResult> {
  const written: string[] = []
  const fromEnvironment: string[] = []
  for (const [key, value] of Object.entries(SEED_CONFIG_VALUES)) {
    if (process.env[key.toUpperCase()]) {
      fromEnvironment.push(key)
      continue
    }
    const storedValue = { key, value }
    await transaction
      .insert(configTable)
      .values({ key, value: storedValue })
      .onConflictDoUpdate({
        target: configTable.key,
        // An upsert bypasses Drizzle's `updatedAt` hook, so the column is set explicitly.
        set: { value: storedValue, updatedAt: sql`now()` },
      })
    written.push(key)
  }
  return { written, fromEnvironment }
}
