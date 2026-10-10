import { like } from "drizzle-orm"
import { Effect, ManagedRuntime } from "effect"
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
import { Config } from "./config"
import { seedConfig } from "../../../scripts/seed/config"

const destinationSettings = {
  endpoint: "http://127.0.0.1:9000/storage/v1/s3",
  region: "us-east-1",
  bucket: "test-files",
  accessKeyId: "first-key",
  secretAccessKey: "first-secret",
  pathStyle: true,
}
const destinationUpdates = [
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
    await getAuthDatabase().delete(configTable).where(like(configTable.key, "s3_%"))
  })
  afterEach(async () => {
    await getAuthDatabase().delete(configTable).where(like(configTable.key, "s3_%"))
    vi.unstubAllEnvs()
  })

  test("pins the destination across runtimes, permits credential rotation and rejects environment drift", async () => {
    const runtime = ManagedRuntime.make(Config.layer)
    try {
      vi.stubEnv("RUSTFS_HOST_PORT", "19000")
      vi.stubEnv("RUSTFS_ACCESS_KEY", "override-key")
      vi.stubEnv("RUSTFS_SECRET_KEY", "override-secret")
      await getAuthDatabase().transaction((transaction) => seedConfig(transaction, "worktree_a"))
      const seeded = await runtime.runPromise(Effect.flatMap(Config, (config) => config.snapshot))
      expect(seeded.values).toMatchObject({
        s3_endpoint: "http://127.0.0.1:19000",
        s3_bucket: "astralbeam-worktree-a-87a94f0b35f63660202c7253320e5053",
        s3_access_key_id: "override-key",
        s3_secret_access_key: "override-secret",
      })
      const buckets = new Set<string>()
      for (const name of ["worktree_a", "worktree-a", "Worktree_a", "x".repeat(63)]) {
        await getAuthDatabase().transaction((transaction) => seedConfig(transaction, name))
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
        Effect.flatMap(Config, (config) => config.reserveStorageDestination(destinationSettings)),
      )
      await runtime.runPromise(
        Effect.flatMap(Config, (config) =>
          config.update([{ key: "s3_secret_access_key", value: "rotated-secret" }]),
        ),
      )
    } finally {
      await runtime.dispose()
    }
    const restarted = ManagedRuntime.make(Config.layer)
    try {
      vi.stubEnv("S3_ENDPOINT", "http://127.0.0.1:9000")
      await getAuthDatabase().transaction((transaction) => seedConfig(transaction, "worktree_b"))
      vi.stubEnv("S3_ENDPOINT", "")
      const result = await restarted.runPromise(
        Effect.flatMap(Config, (config) =>
          config.update([{ key: "s3_endpoint", value: "http://127.0.0.1:9000/other" }]),
        ).pipe(Effect.result),
      )
      expect(result._tag).toBe("Failure")
      const values = await restarted.runPromise(
        Effect.flatMap(Config, (config) => config.snapshot).pipe(
          Effect.map((snapshot) => snapshot.values),
        ),
      )
      expect(values.s3_endpoint).toBe(destinationSettings.endpoint)
      expect(values.s3_access_key_id).toBe("first-key")
      expect(values.s3_secret_access_key).toBe("rotated-secret")
      vi.stubEnv("S3_BUCKET", "environment-bucket")
      await restarted.runPromise(Effect.flatMap(Config, (config) => config.invalidate))
      const snapshot = await restarted.runPromise(
        Effect.flatMap(Config, (config) => config.snapshot),
      )
      expect(snapshot.issues.some((issue) => issue.key === "s3_endpoint")).toBe(true)
      const pin = await restarted.runPromise(
        Effect.flatMap(Config, (config) =>
          config.reserveStorageDestination({
            ...destinationSettings,
            bucket: "environment-bucket",
          }),
        ).pipe(Effect.result),
      )
      expect(pin._tag).toBe("Failure")
    } finally {
      await restarted.dispose()
    }
  })

  test("serializes the first upload reservation against a destination edit on another replica", async () => {
    const uploader = ManagedRuntime.make(Config.layer)
    const operator = ManagedRuntime.make(Config.layer)
    try {
      await operator.runPromise(
        Effect.flatMap(Config, (config) => config.update(destinationUpdates)),
      )
      await uploader.runPromise(Effect.flatMap(Config, (config) => config.snapshot))
      const results = await Promise.all([
        uploader.runPromise(
          Effect.flatMap(Config, (config) =>
            config.reserveStorageDestination(destinationSettings),
          ).pipe(Effect.result),
        ),
        operator.runPromise(
          Effect.flatMap(Config, (config) =>
            config.update([{ key: "s3_bucket", value: "other-bucket" }]),
          ).pipe(Effect.result),
        ),
      ])
      expect(results.filter((result) => result._tag === "Success")).toHaveLength(1)
    } finally {
      await Promise.all([uploader.dispose(), operator.dispose()])
    }
  })
})
