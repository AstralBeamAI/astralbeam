export const usagePeriods = {
  month: "This month",
  previousMonth: "Previous month",
  week: "This week (Mon–Sun)",
  previousWeek: "Previous week (Mon–Sun)",
  last30Days: "Last 30 days",
  last7Days: "Last 7 days",
} as const

export type UsagePeriod = keyof typeof usagePeriods

export function usagePeriodRange(period: UsagePeriod, now = new Date()) {
  const day = 86_400_000
  const month = (offset: number) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)
  const monday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - ((now.getUTCDay() + 6) % 7),
  )
  const ranges = {
    month: [month(0), month(1)],
    previousMonth: [month(-1), month(0)],
    week: [monday, monday + 7 * day],
    previousWeek: [monday - 7 * day, monday],
    last30Days: [now.getTime() - 30 * day, now.getTime()],
    last7Days: [now.getTime() - 7 * day, now.getTime()],
  } as const
  const [start, end] = ranges[period]
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() }
}
