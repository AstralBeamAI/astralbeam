import { Effect, Schedule } from "effect"

import { deleteExpiredDatabaseCacheBatch } from "../db/cache.server.ts"

const expiredCacheCleanup = Effect.gen(function* () {
  yield* deleteExpiredDatabaseCacheBatch.pipe(
    Effect.repeat({
      while: (deleted) => deleted > 0,
      schedule: Schedule.spaced("10 millis"),
    }),
  )
  yield* Effect.logInfo("Expired cache cleanup completed")
})

export default expiredCacheCleanup
