import { Cron, Layer } from "effect"
import { ClusterCron } from "effect/cluster"

import expiredCacheCleanup from "./expired-cache-cleanup.server.ts"
import modelPriceCatalogRefresh from "./model-price-catalog-refresh.server.ts"

export const scheduledWorkflowsLayer = Layer.mergeAll(
  ClusterCron.make({
    name: "ExpiredCacheCleanup/v1",
    cron: Cron.parseUnsafe("0 */5 * * * *", "UTC"),
    calculateNextRunFromPrevious: false,
    skipIfOlderThan: "10 minutes",
    execute: expiredCacheCleanup,
  }),
  ClusterCron.make({
    name: "ModelPriceCatalogRefresh/v1",
    cron: Cron.parseUnsafe("0 0 3 * * *", "UTC"),
    calculateNextRunFromPrevious: false,
    skipIfOlderThan: "1 hour",
    execute: modelPriceCatalogRefresh,
  }),
)
