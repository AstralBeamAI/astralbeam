import { eq, sql } from "drizzle-orm"

import { db } from "@/db/index.server"
import { configTable } from "@/db/schema.server"
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
        key: configTable.key,
        value: configTable.value,
        updatedAt: configTable.updatedAt,
        updatedBy: configTable.updatedBy,
      })
      .from(configTable)
  } catch (error) {
    if (isMissingTableError(error)) return null
    throw error
  }
}

export async function upsertConfigValue(
  { key, value, updatedBy }: { key: string; value: unknown; updatedBy: string | null },
): Promise<void> {
  await db
    .insert(configTable)
    .values({ key, value, updatedBy })
    .onConflictDoUpdate({
      target: configTable.key,
      // Upserts bypass Drizzle's $onUpdateFn hook, so updated_at is set explicitly.
      set: { value, updatedBy, updatedAt: sql`now()` },
    })
}

export async function deleteConfigValue(key: string): Promise<void> {
  await db.delete(configTable).where(eq(configTable.key, key))
}
