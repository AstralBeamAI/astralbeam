import { toast } from "@/components/ui/toast"
import { type UsageLimitFields, USAGE_LIMIT_SUBJECTS_PAGE_SIZE } from "@/lib/usage-limits/schemas"
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

/** The last page of a limit's usage list, which is page 1 even when nothing is listed. */
export function lastUsageLimitSubjectsPage(total: number): number {
  return Math.max(1, Math.ceil(total / USAGE_LIMIT_SUBJECTS_PAGE_SIZE))
}

export function summarizeUsageLimit(limit: UsageLimitFields): string {
  const subject = {
    global: "This organization shares",
    tenant: "Each tenant has",
    tenant_user: "Each tenant user has",
    thread: "Each conversation has",
  }[limit.scope]
  const period = `${limit.windowCount} ${limit.windowUnit}${limit.windowCount === 1 ? "" : "s"}`
  const reset =
    limit.windowType === "fixed"
      ? `Resets on calendar boundaries in ${limit.timeZone}.`
      : "Starts at first use and resets when that period ends."
  return `${subject} a budget of ${formatUsageLimitAmount(limit)} per ${period}. ${reset}${limit.appliesByDefault ? "" : " Applies only when included in the chat token."}`
}
