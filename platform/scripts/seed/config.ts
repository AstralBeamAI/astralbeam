import process from "node:process"

import { BucketAlreadyOwnedByYou, CreateBucketCommand, S3Client } from "@aws-sdk/client-s3"
import { eq, like, sql } from "drizzle-orm"

import { configTable } from "../../src/db/schema.server.ts"

import type { SeedDatabase, SeedTransaction } from "./database.ts"
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
export async function seedConfig(
  transaction: SeedTransaction,
  databaseName: string,
): Promise<SeedConfigResult> {
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
    s3_bucket: `astralbeam-${databaseName.replaceAll("_", "-")}`,
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

export async function initializeStorage(database: SeedDatabase): Promise<void> {
  if (process.env.SKIP_DOCKER_COMPOSE === "true") return
  const rows = await database.select().from(configTable).where(like(configTable.key, "s3_%"))
  const value = (key: string) =>
    process.env[key.toUpperCase()] ||
    rows.find((row) => row.key === key && row.value.key === key)?.value.value ||
    ""
  const endpoint = new URL(value("s3_endpoint").replace(/\/+$/, ""))
  if (
    !["127.0.0.1", "localhost", "rustfs"].includes(endpoint.hostname) ||
    endpoint.pathname !== "/"
  )
    return
  const client = new S3Client({
    endpoint: endpoint.href,
    region: value("s3_region"),
    credentials: {
      accessKeyId: value("s3_access_key_id"),
      secretAccessKey: value("s3_secret_access_key"),
    },
    forcePathStyle: value("s3_path_style") === "true",
    maxAttempts: 2,
    requestChecksumCalculation: "WHEN_REQUIRED",
  })
  try {
    await client.send(new CreateBucketCommand({ Bucket: value("s3_bucket") }), {
      abortSignal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    if (!(error instanceof BucketAlreadyOwnedByYou))
      throw new Error(
        "Local storage setup failed. Check that RustFS is running and its credentials match File storage settings.",
      )
  } finally {
    client.destroy()
  }
}
