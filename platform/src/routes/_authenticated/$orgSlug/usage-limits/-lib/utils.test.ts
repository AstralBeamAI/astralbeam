import { expect, test } from "vitest"
import { summarizeUsageLimit } from "./utils"

test("limit summaries distinguish calendar resets from first-use periods and token targeting", () => {
  const limit = {
    name: "Budget",
    enabled: true,
    appliesByDefault: true,
    scope: "tenant_user",
    metric: "tokens",
    amount: "100000",
    windowCount: 1,
    windowUnit: "month",
    windowType: "fixed",
    timeZone: "Asia/Kolkata",
  } as const
  expect(summarizeUsageLimit(limit)).toBe(
    "Each tenant user has a budget of 100,000 tokens per 1 month. Resets on calendar boundaries in Asia/Kolkata.",
  )
  expect(
    summarizeUsageLimit({
      ...limit,
      appliesByDefault: false,
      windowType: "rolling",
      timeZone: null,
    }),
  ).toBe(
    "Each tenant user has a budget of 100,000 tokens per 1 month. Starts at first use and resets when that period ends. Applies only when included in the chat token.",
  )
})
