import { Cron, Effect, Layer } from "effect"
import { ClusterCron } from "effect/cluster"

import { ProfileFiles } from "@/lib/storage/profile-files.server"
import { Uploads } from "@/lib/chat/attachments/uploads.server"
import { StoredFiles } from "@/lib/storage/stored-files.server"

import { reportStorageHealth } from "@/lib/storage/health.server"

import expiredCacheCleanup from "./expired-cache-cleanup.server.ts"

export const scheduledWorkflowsLayer = Layer.mergeAll(
  ClusterCron.make({
    name: "ExpiredCacheCleanup/v1",
    cron: Cron.parseUnsafe("0 */5 * * * *", "UTC"),
    calculateNextRunFromPrevious: false,
    skipIfOlderThan: "10 minutes",
    execute: expiredCacheCleanup,
  }),
  ClusterCron.make({
    name: "FileMaintenance/v1",
    cron: Cron.parseUnsafe("0 * * * * *", "UTC"),
    calculateNextRunFromPrevious: false,
    skipIfOlderThan: "10 minutes",
    execute: Effect.gen(function* () {
      yield* reportStorageHealth
      yield* (yield* StoredFiles).cleanup
      yield* (yield* ProfileFiles).processImports
      yield* (yield* Uploads).maintenance
    }),
  }),
)
