import { Cron } from "effect"
import { ClusterCron } from "effect/unstable/cluster"

import expiredCacheCleanup from "./expired-cache-cleanup.ts"

export const scheduledWorkflowsLayer = ClusterCron.make({
  name: "ExpiredCacheCleanup/v1",
  cron: Cron.parseUnsafe("0 */5 * * * *", "UTC"),
  calculateNextRunFromPrevious: false,
  skipIfOlderThan: "10 minutes",
  execute: expiredCacheCleanup,
})
