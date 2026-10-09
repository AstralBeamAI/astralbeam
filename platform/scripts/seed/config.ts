import process from "node:process"

import { eq, sql } from "drizzle-orm"

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
 * upserted through the same encrypted-column codec `src/lib/config/store.server.ts` uses.
 */
export async function seedConfig(transaction: SeedTransaction): Promise<SeedConfigResult> {
  const written: string[] = []
  const fromEnvironment: string[] = []
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('file-storage-destination', 0))`,
  )
  const [storagePin] = await transaction
    .select({ key: configTable.key })
    .from(configTable)
    .where(eq(configTable.key, "s3_destination"))
  const values = {
    ...SEED_CONFIG_VALUES,
    s3_endpoint: `http://127.0.0.1:${process.env.RUSTFS_HOST_PORT || 9000}`,
    s3_access_key_id: process.env.RUSTFS_ACCESS_KEY || SEED_CONFIG_VALUES.s3_access_key_id,
    s3_secret_access_key: process.env.RUSTFS_SECRET_KEY || SEED_CONFIG_VALUES.s3_secret_access_key,
  }
  for (const [key, value] of Object.entries(values)) {
    if (storagePin && key.startsWith("s3_")) continue
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
