import { Cron, Layer } from "effect"
import { ClusterCron } from "effect/cluster"

import fileMaintenance from "./file-maintenance.ts"
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
  // Reclaims abandoned uploads and schedules pending logo imports once a minute.
  ClusterCron.make({
    name: "FileMaintenance/v1",
    cron: Cron.parseUnsafe("0 * * * * *", "UTC"),
    calculateNextRunFromPrevious: false,
    skipIfOlderThan: "10 minutes",
    execute: fileMaintenance,
  }),
  ClusterCron.make({
    name: "ModelPriceCatalogRefresh/v1",
    cron: Cron.parseUnsafe("0 0 3 * * *", "UTC"),
    calculateNextRunFromPrevious: false,
    skipIfOlderThan: "1 hour",
    execute: modelPriceCatalogRefresh,
  }),
)
