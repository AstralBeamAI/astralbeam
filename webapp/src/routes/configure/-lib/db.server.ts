import { eq, sql } from "drizzle-orm"

import { db } from "@/db/index.server"
import { config } from "@/db/schema.server"
import { isMissingTableError } from "@/lib/config.server"

interface ConfigRow {
  key: string
  value: unknown
  updatedAt: Date
  updatedBy: string | null
}

// Returns null while the config table does not exist yet (fresh database before migrations).
export async function listConfigRows(): Promise<ConfigRow[] | null> {
  try {
    return await db
      .select({
        key: config.key,
        value: config.value,
        updatedAt: config.updatedAt,
        updatedBy: config.updatedBy,
      })
      .from(config)
  } catch (error) {
    if (isMissingTableError(error)) return null
    throw error
  }
}

export async function upsertConfigValue(
  { key, value, updatedBy }: { key: string; value: unknown; updatedBy: string | null },
): Promise<void> {
  await db
    .insert(config)
    .values({ key, value, updatedBy })
    .onConflictDoUpdate({
      target: config.key,
      // Upserts bypass Drizzle's $onUpdateFn hook, so updated_at is set explicitly.
      set: { value, updatedBy, updatedAt: sql`now()` },
    })
}

export async function deleteConfigValue(key: string): Promise<void> {
  await db.delete(config).where(eq(config.key, key))
}
