import { DateTime } from "effect"

import type { UsageLimitFields } from "./schemas.ts"

type UsageLimitWindowFields = Pick<
  UsageLimitFields,
  "windowType" | "windowCount" | "windowUnit" | "timeZone"
>

const unitMillis = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }
// Fixed windows count whole units from a Monday, so weekly windows start on Mondays.
const FIXED_WINDOW_ORIGIN = Date.UTC(2000, 0, 3)

/** Reads an instant's wall-clock time in a zone as if it were UTC, so unit arithmetic ignores offsets. */
function wallMillis(instant: Date, timeZone: string) {
  const parts = DateTime.toParts(DateTime.makeZonedUnsafe(instant, { timeZone }))
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
}

function fromWallMillis(wall: number, timeZone: string) {
  return DateTime.toDateUtc(
    DateTime.makeZonedUnsafe(wall, {
      timeZone,
      adjustForTimeZone: true,
      disambiguation: "earlier",
    }),
  )
}

function addWallUnits(wall: number, unit: UsageLimitFields["windowUnit"], count: number) {
  if (unit !== "month") return wall + count * unitMillis[unit]
  const date = new Date(wall)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1)
}

/** The start of the fixed window containing `now`, aligned to whole multiples of its duration. */
function fixedWindowStartWall(limit: UsageLimitWindowFields, now: Date) {
  const wall = wallMillis(now, limit.timeZone!)
  if (limit.windowUnit !== "month") {
    const size = limit.windowCount * unitMillis[limit.windowUnit]
    return FIXED_WINDOW_ORIGIN + Math.floor((wall - FIXED_WINDOW_ORIGIN) / size) * size
  }
  const date = new Date(wall)
  const months = (date.getUTCFullYear() - 2000) * 12 + date.getUTCMonth()
  return Date.UTC(2000, months - (months % limit.windowCount), 1)
}

/**
 * When the window that usage at `now` opens would end. Counters store this end, so reads and the
 * atomic upsert test liveness with one comparison instead of inverting clamped month arithmetic.
 */
export function usageLimitWindowEnd(limit: UsageLimitWindowFields, now: Date): Date {
  if (limit.windowType === "rolling")
    return DateTime.toDateUtc(
      DateTime.add(DateTime.makeUnsafe(now), { [`${limit.windowUnit}s`]: limit.windowCount }),
    )
  const start = fixedWindowStartWall(limit, now)
  return fromWallMillis(addWallUnits(start, limit.windowUnit, limit.windowCount), limit.timeZone!)
}
