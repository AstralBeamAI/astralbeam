import { expect, test } from "vitest"
import { usagePeriodRange } from "./usage-period.ts"

test("calendar periods cross year and Sunday boundaries in UTC", () => {
  const now = new Date("2026-01-04T23:59:59.123Z")
  expect(usagePeriodRange("month", now)).toEqual({
    start: "2026-01-01T00:00:00.000Z",
    end: "2026-02-01T00:00:00.000Z",
  })
  expect(usagePeriodRange("previousMonth", now)).toEqual({
    start: "2025-12-01T00:00:00.000Z",
    end: "2026-01-01T00:00:00.000Z",
  })
  expect(usagePeriodRange("week", now)).toEqual({
    start: "2025-12-29T00:00:00.000Z",
    end: "2026-01-05T00:00:00.000Z",
  })
  expect(usagePeriodRange("previousWeek", now)).toEqual({
    start: "2025-12-22T00:00:00.000Z",
    end: "2025-12-29T00:00:00.000Z",
  })
  expect(usagePeriodRange("week", new Date("2026-01-05T00:00:00Z"))).toEqual({
    start: "2026-01-05T00:00:00.000Z",
    end: "2026-01-12T00:00:00.000Z",
  })
  expect(usagePeriodRange("previousMonth", new Date("2024-03-01T00:00:00Z"))).toEqual({
    start: "2024-02-01T00:00:00.000Z",
    end: "2024-03-01T00:00:00.000Z",
  })
})

test("rolling periods retain the exact instant across month boundaries", () => {
  const now = new Date("2026-03-10T14:32:56.123Z")
  expect(usagePeriodRange("last7Days", now)).toEqual({
    start: "2026-03-03T14:32:56.123Z",
    end: "2026-03-10T14:32:56.123Z",
  })
  expect(usagePeriodRange("last30Days", now)).toEqual({
    start: "2026-02-08T14:32:56.123Z",
    end: "2026-03-10T14:32:56.123Z",
  })
})
