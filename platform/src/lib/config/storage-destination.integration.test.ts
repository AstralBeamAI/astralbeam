import { like } from "drizzle-orm"
import { Effect, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const storageDatabase = vi.hoisted(() => {
  const url = process.env.S3_TEST_DATABASE === "true" ? process.env.DATABASE_URL : undefined
  if (url) {
    const parsed = new URL(url)
    if (parsed.hostname !== "127.0.0.1" || !parsed.pathname.endsWith("_test"))
      throw new Error("Use a disposable loopback database ending in _test")
  }
  return { url }
})

import { getAuthDatabase } from "@/db/database.server"
import { configTable } from "@/db/schema.server"
import { Config } from "./config.server"

const destinationSettings = {
  endpoint: "http://127.0.0.1:9000",
  region: "us-east-1",
  bucket: "test-files",
  accessKeyId: "first-key",
  secretAccessKey: "first-secret",
  pathStyle: true,
}
const destinationUpdates = Object.entries(destinationSettings).map(([key, value]) => ({
  key: (
    {
      endpoint: "s3_endpoint",
      region: "s3_region",
      bucket: "s3_bucket",
      accessKeyId: "s3_access_key_id",
      secretAccessKey: "s3_secret_access_key",
      pathStyle: "s3_path_style",
    } as Record<string, string>
  )[key]!,
  value: String(value),
}))

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
      const result = await restarted.runPromise(
        Effect.flatMap(Config, (config) =>
          config.update([{ key: "s3_bucket", value: "other-bucket" }]),
        ).pipe(Effect.result),
      )
      expect(result._tag).toBe("Failure")
      const values = await restarted.runPromise(
        Effect.flatMap(Config, (config) => config.snapshot).pipe(
          Effect.map((snapshot) => snapshot.values),
        ),
      )
      expect(values.s3_bucket).toBe(destinationSettings.bucket)
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
