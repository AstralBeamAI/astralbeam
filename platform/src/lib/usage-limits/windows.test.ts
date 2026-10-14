import { describe, expect, it } from "vitest"

import { usageLimitWindowEnd } from "./windows.ts"

const at = (iso: string) => new Date(iso)

describe("usage limit windows", () => {
  it("ends fixed windows on calendar boundaries in the limit's time zone", () => {
    const monthly = {
      windowType: "fixed",
      windowCount: 1,
      windowUnit: "month",
      timeZone: "Asia/Kolkata",
    } as const
    // 2026-10-31T20:00Z is already November 1st in Kolkata.
    expect(usageLimitWindowEnd(monthly, at("2026-10-31T20:00:00Z"))).toEqual(
      at("2026-11-30T18:30:00Z"),
    )
    const weekly = { ...monthly, windowUnit: "week", timeZone: "UTC" } as const
    expect(usageLimitWindowEnd(weekly, at("2026-10-14T09:00:00Z"))).toEqual(
      at("2026-10-19T00:00:00Z"),
    )
    const quarterly = { ...monthly, windowCount: 3, timeZone: "UTC" } as const
    expect(usageLimitWindowEnd(quarterly, at("2026-11-20T00:00:00Z"))).toEqual(
      at("2027-01-01T00:00:00Z"),
    )
    const sixHours = { ...monthly, windowCount: 6, windowUnit: "hour", timeZone: "UTC" } as const
    expect(usageLimitWindowEnd(sixHours, at("2026-10-14T13:59:00Z"))).toEqual(
      at("2026-10-14T18:00:00Z"),
    )
  })

  it("keeps fixed days on local midnight across a daylight saving change", () => {
    const daily = {
      windowType: "fixed",
      windowCount: 1,
      windowUnit: "day",
      timeZone: "America/New_York",
    } as const
    // New York leaves daylight saving time on 2026-11-01, so that day lasts 25 hours.
    expect(usageLimitWindowEnd(daily, at("2026-11-01T12:00:00Z"))).toEqual(
      at("2026-11-02T05:00:00Z"),
    )
  })

  it("ends rolling windows one duration after first use, clamping month ends", () => {
    const rolling = { windowType: "rolling", timeZone: null } as const
    expect(
      usageLimitWindowEnd(
        { ...rolling, windowCount: 5, windowUnit: "hour" },
        at("2026-10-14T09:30:00Z"),
      ),
    ).toEqual(at("2026-10-14T14:30:00Z"))
    const month = { ...rolling, windowCount: 1, windowUnit: "month" } as const
    expect(usageLimitWindowEnd(month, at("2026-01-31T10:00:00Z"))).toEqual(
      at("2026-02-28T10:00:00Z"),
    )
    expect(usageLimitWindowEnd(month, at("2028-01-31T10:00:00Z"))).toEqual(
      at("2028-02-29T10:00:00Z"),
    )
  })
})
