import { toast } from "@/components/ui/toast"
import type { UsageLimit } from "@/lib/usage-limits/usage-limits.server"

type UsageLimitWindow = Pick<UsageLimit, "windowCount" | "windowUnit" | "windowType" | "timeZone">

const usageLimitPresetLabels: Partial<Record<UsageLimit["windowUnit"], string>> = {
  month: "Monthly",
  week: "Weekly",
  day: "Daily",
}

/** Monthly, Weekly, and Daily are one-unit presets of the stored count and unit. */
export function usageLimitDuration(limit: Pick<UsageLimit, "windowCount" | "windowUnit">) {
  const unit = limit.windowUnit
  return limit.windowCount === 1 && (unit === "month" || unit === "week" || unit === "day")
    ? unit
    : "custom"
}

/** Reads like "Monthly, fixed in UTC" or "Every 5 hours, rolling". */
export function describeUsageLimitWindow(limit: UsageLimitWindow): string {
  const preset = limit.windowCount === 1 ? usageLimitPresetLabels[limit.windowUnit] : undefined
  const period =
    preset ??
    `Every ${limit.windowCount === 1 ? "" : `${limit.windowCount} `}${limit.windowUnit}${limit.windowCount === 1 ? "" : "s"}`
  return limit.windowType === "fixed"
    ? `${period}, fixed in ${limit.timeZone?.replaceAll("_", " ")}`
    : `${period}, rolling`
}

export function formatUsageLimitAmount(limit: Pick<UsageLimit, "metric" | "amount">): string {
  const amount = Number(limit.amount)
  return limit.metric === "tokens"
    ? `${amount.toLocaleString("en-US")} tokens`
    : amount.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

export async function copyUsageLimitId(id: string): Promise<void> {
  try {
    await globalThis.navigator.clipboard.writeText(id)
    toast.add({ title: "Usage limit ID copied", type: "success" })
  } catch {
    toast.add({ title: "The usage limit ID could not be copied", type: "error" })
  }
}
