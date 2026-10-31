import { like, or } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const storageDatabase = vi.hoisted(() => {
  const configured = process.env.DATABASE_URL
  const url = configured === "postgres://test:test@127.0.0.1:5432/test" ? undefined : configured
  if (url) {
    const parsed = new URL(url)
    if (parsed.hostname !== "127.0.0.1" || !parsed.pathname.endsWith("_test"))
      throw new Error("Use a disposable loopback database ending in _test")
  }
  return { url }
})

import { getAuthDatabase } from "@/db/database"
import { configTable } from "@/db/schema"
import { ObjectStorage } from "@/lib/storage/object-storage.server"
import { Config } from "./config"
import { seedConfig } from "@scripts/seed/config"

const destinationSettings = {
  endpoint: "http://127.0.0.1:9000/storage/v1/s3",
  region: "us-east-1",
  bucket: "test-files",
  accessKeyId: "first-key",
  secretAccessKey: "first-secret",
  pathStyle: true,
}
const destinationUpdates = [
  { key: "storage_provider", value: "s3" },
  { key: "s3_endpoint", value: destinationSettings.endpoint },
  { key: "s3_region", value: destinationSettings.region },
  { key: "s3_bucket", value: destinationSettings.bucket },
  { key: "s3_access_key_id", value: destinationSettings.accessKeyId },
  { key: "s3_secret_access_key", value: destinationSettings.secretAccessKey },
  { key: "s3_path_style", value: "true" },
]

describe.skipIf(!storageDatabase.url)("storage destination persistence", () => {
  beforeEach(async () => {
    for (const { key } of destinationUpdates) vi.stubEnv(key.toUpperCase(), "")
    vi.stubEnv("STORAGE_DIRECTORY", "")
    await getAuthDatabase()
      .delete(configTable)
      .where(or(like(configTable.key, "s3_%"), like(configTable.key, "storage_%")))
  })
  afterEach(async () => {
    await getAuthDatabase()
      .delete(configTable)
      .where(or(like(configTable.key, "s3_%"), like(configTable.key, "storage_%")))
    vi.unstubAllEnvs()
  })

  test("preserves storage through reseeding and provider changes", async () => {
    const runtime = ManagedRuntime.make(Config.layer)
    try {
      vi.stubEnv("RUSTFS_HOST_PORT", "19000")
      vi.stubEnv("RUSTFS_ACCESS_KEY", "override-key")
      vi.stubEnv("RUSTFS_SECRET_KEY", "override-secret")
      await getAuthDatabase().transaction((transaction) =>
        seedConfig(transaction, "worktree_a", "s3"),
      )
      const seeded = await runtime.runPromise(Effect.flatMap(Config, (config) => config.snapshot))
      expect(seeded.values).toMatchObject({
        s3_endpoint: "http://127.0.0.1:19000",
        s3_access_key_id: "override-key",
        s3_secret_access_key: "override-secret",
      })
      const buckets = new Set<string>()
      for (const name of ["worktree_a", "worktree-a", "Worktree_a", "x".repeat(63)]) {
        await getAuthDatabase().delete(configTable).where(like(configTable.key, "s3_%"))
        await getAuthDatabase().transaction((transaction) => seedConfig(transaction, name, "s3"))
        await runtime.runPromise(Effect.flatMap(Config, (config) => config.invalidate))
        const { values } = await runtime.runPromise(
          Effect.flatMap(Config, (config) => config.snapshot),
        )
        expect(values.s3_bucket).toMatch(/^[a-z0-9-]{3,63}$/)
        buckets.add(values.s3_bucket!)
      }
      expect(buckets.size).toBe(4)
      await runtime.runPromise(
        Effect.flatMap(Config, (config) => config.update(destinationUpdates)),
      )
      await runtime.runPromise(
        Effect.flatMap(Config, (config) =>
          config.update([
            { key: "s3_secret_access_key", value: "rotated-secret" },
            { key: "storage_provider", value: "filesystem" },
            { key: "storage_directory", value: "/storage-test-files" },
          ]),
        ),
      )
      await getAuthDatabase().transaction((transaction) =>
        seedConfig(transaction, "worktree_b", "filesystem"),
      )
    } finally {
      await runtime.dispose()
    }
    const restarted = ManagedRuntime.make(Config.layer)
    try {
      const values = await restarted.runPromise(
        Effect.flatMap(Config, (config) => config.snapshot).pipe(
          Effect.map((snapshot) => snapshot.values),
        ),
      )
      expect(values.storage_provider).toBe("filesystem")
      expect(values.storage_directory).toBe("/storage-test-files")
      expect(values.s3_endpoint).toBe(destinationSettings.endpoint)
      expect(values.s3_access_key_id).toBe("first-key")
      expect(values.s3_secret_access_key).toBe("rotated-secret")
    } finally {
      await restarted.dispose()
    }
  })

  test("changes a legacy pinned destination and uses the new settings for object access", async () => {
    await getAuthDatabase()
      .insert(configTable)
      .values({
        key: "s3_destination",
        value: {
          key: "s3_destination",
          value: JSON.stringify({
            endpoint: destinationSettings.endpoint,
            region: destinationSettings.region,
            bucket: destinationSettings.bucket,
            pathStyle: destinationSettings.pathStyle,
          }),
        },
      })
    const runtime = ManagedRuntime.make(Layer.merge(Config.layer, ObjectStorage.layer))
    try {
      await runtime.runPromise(
        Effect.flatMap(Config, (config) => config.update(destinationUpdates)),
      )
      const initialUrl = await runtime.runPromise(
        Effect.flatMap(ObjectStorage, (storage) => storage.signedUrl({ key: "existing-file" })),
      )
      expect(new URL(initialUrl!).pathname).toBe("/storage/v1/s3/test-files/existing-file")
      await runtime.runPromise(
        Effect.flatMap(Config, (config) =>
          config.update([
            { key: "s3_endpoint", value: "https://s3.us-west-2.amazonaws.com" },
            { key: "s3_region", value: "us-west-2" },
            { key: "s3_bucket", value: "other-bucket" },
            { key: "s3_path_style", value: "false" },
          ]),
        ),
      )
      const changedUrl = await runtime.runPromise(
        Effect.flatMap(ObjectStorage, (storage) => storage.signedUrl({ key: "existing-file" })),
      )
      expect(new URL(changedUrl!).origin).toBe("https://other-bucket.s3.us-west-2.amazonaws.com")
      vi.stubEnv("S3_BUCKET", "environment-bucket")
      await runtime.runPromise(Effect.flatMap(Config, (config) => config.invalidate))
      const snapshot = await runtime.runPromise(Effect.flatMap(Config, (config) => config.snapshot))
      expect(snapshot.values.s3_bucket).toBe("environment-bucket")
      expect(snapshot.issues.filter((issue) => issue.key.startsWith("s3_"))).toEqual([])
    } finally {
      await runtime.dispose()
    }
  })
})
