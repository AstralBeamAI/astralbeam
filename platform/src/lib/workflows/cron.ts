import { Cron, Effect, Layer } from "effect"
import { ClusterCron } from "effect/cluster"

import { StoredFiles } from "@/lib/storage/stored-files.server"
import expiredCacheCleanup from "./expired-cache-cleanup.ts"
import modelPriceCatalogRefresh from "./model-price-catalog-refresh.ts"

export const scheduledWorkflowsLayer = Layer.mergeAll(
  ClusterCron.make({
    name: "ExpiredCacheCleanup/v1",
    cron: Cron.parseUnsafe("0 */5 * * * *", "UTC"),
    calculateNextRunFromPrevious: false,
    skipIfOlderThan: "10 minutes",
    execute: expiredCacheCleanup,
  }),
  // Finds abandoned uploads and recovers missed purge submissions once a minute.
  ClusterCron.make({
    name: "FileMaintenance/v1",
    cron: Cron.parseUnsafe("0 * * * * *", "UTC"),
    calculateNextRunFromPrevious: false,
    skipIfOlderThan: "10 minutes",
    execute: Effect.flatMap(StoredFiles, (files) => files.cleanup),
  }),
  ClusterCron.make({
    name: "ModelPriceCatalogRefresh/v1",
    cron: Cron.parseUnsafe("0 0 3 * * *", "UTC"),
    calculateNextRunFromPrevious: false,
    skipIfOlderThan: "1 hour",
    execute: modelPriceCatalogRefresh,
  }),
)
