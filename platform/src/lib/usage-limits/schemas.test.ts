import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import { formatUsageLimitId, parseUsageLimitId, UsageLimitFieldsSchema } from "./schemas.ts"

const validFields = {
  name: "Weekly limit",
  enabled: true,
  appliesByDefault: false,
  scope: "tenant_user",
  metric: "tokens",
  amount: "1000000",
  windowType: "fixed",
  windowCount: 1,
  windowUnit: "week",
  timeZone: "Asia/Kolkata",
} as const
const isUsageLimitFields = Schema.is(UsageLimitFieldsSchema)

describe("usage limit schemas", () => {
  it("accepts token and dollar amounts in their own formats", () => {
    expect(isUsageLimitFields(validFields)).toBe(true)
    expect(isUsageLimitFields({ ...validFields, metric: "spend", amount: "12.50" })).toBe(true)
    expect(isUsageLimitFields({ ...validFields, amount: "12.5" })).toBe(false)
    expect(isUsageLimitFields({ ...validFields, metric: "spend", amount: "0.00" })).toBe(false)
    expect(isUsageLimitFields({ ...validFields, metric: "spend", amount: "1.005" })).toBe(false)
  })

  it("rejects combinations the database would refuse or enforcement could not honor", () => {
    expect(isUsageLimitFields({ ...validFields, timeZone: null })).toBe(false)
    expect(isUsageLimitFields({ ...validFields, windowType: "rolling" })).toBe(false)
    expect(isUsageLimitFields({ ...validFields, timeZone: "Mars/Olympus_Mons" })).toBe(false)
    expect(isUsageLimitFields({ ...validFields, scope: "global" })).toBe(false)
    expect(isUsageLimitFields({ ...validFields, windowCount: 53 })).toBe(false)
    expect(isUsageLimitFields({ ...validFields, windowCount: 12, windowUnit: "month" })).toBe(true)
  })

  it("round-trips public IDs and refuses other formats", () => {
    const key = {
      organizationId: "01990a5d-ac96-774b-b942-6b13c85384cb",
      id: "01990a5d-ac96-774b-b942-6b13c85384cd",
    }
    expect(parseUsageLimitId(formatUsageLimitId(key))).toEqual(key)
    expect(parseUsageLimitId(`agent_${key.organizationId}_${key.id}`)).toBeNull()
  })
})
