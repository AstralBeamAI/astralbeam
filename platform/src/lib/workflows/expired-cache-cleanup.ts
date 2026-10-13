import { Effect, Schedule } from "effect"

import { deleteExpiredDatabaseCacheBatch } from "../../db/cache.ts"

const expiredCacheCleanup = Effect.gen(function* () {
  yield* deleteExpiredDatabaseCacheBatch.pipe(
    Effect.repeat({
      while: (deleted) => deleted > 0,
      schedule: Schedule.spaced("10 millis"),
    }),
  )
  yield* Effect.logDebug("Expired cache cleanup completed")
})

export default expiredCacheCleanup
