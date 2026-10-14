export const usageLimitScopeItems = [
  {
    value: "global",
    label: "Global",
    description: "One budget shared by all usage in this organization.",
  },
  {
    value: "tenant",
    label: "Per tenant",
    description: "A separate budget for each tenant, shared by its users.",
  },
  {
    value: "tenant_user",
    label: "Per tenant user",
    description: "A separate budget for each tenant user.",
  },
  {
    value: "thread",
    label: "Per conversation",
    description: "A separate budget for each conversation.",
  },
] as const

export const usageLimitDurationItems = [
  { value: "month", label: "Monthly" },
  { value: "week", label: "Weekly" },
  { value: "day", label: "Daily" },
  { value: "custom", label: "Custom" },
] as const

export const usageLimitWindowUnitItems = [
  { value: "minute", label: "Minutes" },
  { value: "hour", label: "Hours" },
  { value: "day", label: "Days" },
  { value: "week", label: "Weeks" },
  { value: "month", label: "Months" },
] as const

export const usageLimitWindowTypeItems = [
  {
    value: "fixed",
    label: "Fixed",
    description: "Resets on calendar boundaries in a time zone, such as midnight or the 1st.",
  },
  {
    value: "rolling",
    label: "Rolling",
    description: "Starts at each subject's first use and resets once the duration has passed.",
  },
] as const

export const usageLimitMetricItems = [
  { value: "tokens", label: "Tokens" },
  { value: "spend", label: "Spend (USD)" },
] as const
