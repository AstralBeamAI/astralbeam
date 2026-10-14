import { describe, expect, it } from "vitest"

import { usageLimitResetsAt, usageLimitWindowAt } from "./windows.ts"

const at = (iso: string) => new Date(iso)

describe("usage limit windows", () => {
  it("aligns fixed windows to the calendar in the limit's time zone", () => {
    const monthly = {
      windowType: "fixed",
      windowCount: 1,
      windowUnit: "month",
      timeZone: "Asia/Kolkata",
    } as const
    // 2026-10-31T20:00Z is already November 1st in Kolkata.
    const { start } = usageLimitWindowAt(monthly, at("2026-10-31T20:00:00Z"))
    expect(start).toEqual(at("2026-10-31T18:30:00Z"))
    expect(usageLimitResetsAt(monthly, start)).toEqual(at("2026-11-30T18:30:00Z"))

    const weekly = { ...monthly, windowUnit: "week", timeZone: "UTC" } as const
    expect(usageLimitWindowAt(weekly, at("2026-10-14T09:00:00Z")).start).toEqual(
      at("2026-10-12T00:00:00Z"),
    )

    const quarterly = { ...monthly, windowCount: 3, timeZone: "UTC" } as const
    expect(usageLimitWindowAt(quarterly, at("2026-11-20T00:00:00Z")).start).toEqual(
      at("2026-10-01T00:00:00Z"),
    )

    const sixHours = { ...monthly, windowCount: 6, windowUnit: "hour", timeZone: "UTC" } as const
    const window = usageLimitWindowAt(sixHours, at("2026-10-14T13:59:00Z"))
    expect(window.start).toEqual(at("2026-10-14T12:00:00Z"))
    expect(usageLimitResetsAt(sixHours, window.start)).toEqual(at("2026-10-14T18:00:00Z"))
  })

  it("keeps fixed days on local midnight across a daylight saving change", () => {
    const daily = {
      windowType: "fixed",
      windowCount: 1,
      windowUnit: "day",
      timeZone: "America/New_York",
    } as const
    // New York leaves daylight saving time on 2026-11-01, so that day lasts 25 hours.
    const { start } = usageLimitWindowAt(daily, at("2026-11-01T12:00:00Z"))
    expect(start).toEqual(at("2026-11-01T04:00:00Z"))
    expect(usageLimitResetsAt(daily, start)).toEqual(at("2026-11-02T05:00:00Z"))
  })

  it("starts rolling windows at first use and ends them one duration later", () => {
    const fiveHours = {
      windowType: "rolling",
      windowCount: 5,
      windowUnit: "hour",
      timeZone: null,
    } as const
    const now = at("2026-10-14T09:30:00Z")
    expect(usageLimitWindowAt(fiveHours, now)).toEqual({
      start: now,
      staleAt: at("2026-10-14T04:30:00Z"),
    })
    expect(usageLimitResetsAt(fiveHours, now)).toEqual(at("2026-10-14T14:30:00Z"))
  })
})
