import { Schema } from "effect"

// Relative, because seed modules import this under a plain `deno run` without the `@/` alias.
import { DisplayNameSchema, enumSchema, UUID_V7_PATTERN } from "../schemas.ts"

const USAGE_LIMIT_SCOPES = ["global", "tenant", "tenant_user", "thread"] as const
const USAGE_LIMIT_METRICS = ["tokens", "spend"] as const
const USAGE_LIMIT_WINDOW_TYPES = ["fixed", "rolling"] as const
const USAGE_LIMIT_WINDOW_UNITS = ["minute", "hour", "day", "week", "month"] as const

/** The longest window in each unit, so no window exceeds a year. */
const USAGE_LIMIT_MAX_WINDOW_COUNTS = {
  minute: 525_600,
  hour: 8_784,
  day: 366,
  week: 52,
  month: 12,
} as const satisfies Record<(typeof USAGE_LIMIT_WINDOW_UNITS)[number], number>

const USAGE_LIMIT_ID_PATTERN = new RegExp(`^limit_(${UUID_V7_PATTERN})_(${UUID_V7_PATTERN})$`)
const TOKEN_AMOUNT_PATTERN = /^[1-9]\d{0,11}$/
const SPEND_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/

/** The public `limit_<organizationId>_<id>` form that chat tokens list. */
export const UsageLimitIdSchema = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(USAGE_LIMIT_ID_PATTERN, { message: "Enter a valid usage limit ID" }),
  ),
)

/** An IANA time zone name the runtime recognizes, such as `America/New_York`. */
export const TimeZoneSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) => {
        if (value.length === 0 || value.length > 64) return false
        try {
          new Intl.DateTimeFormat("en", { timeZone: value })
          return true
        } catch {
          return false
        }
      },
      { message: "Select a time zone" },
    ),
  ),
)

/** What an Organization member edits. The organization always comes from verified access. */
export const UsageLimitFieldsSchema = Schema.Struct({
  name: DisplayNameSchema,
  enabled: Schema.Boolean,
  appliesByDefault: Schema.Boolean,
  scope: enumSchema(USAGE_LIMIT_SCOPES),
  metric: enumSchema(USAGE_LIMIT_METRICS),
  amount: Schema.String,
  windowType: enumSchema(USAGE_LIMIT_WINDOW_TYPES),
  windowCount: Schema.Int.check(Schema.isGreaterThan(0, { message: "Must be 1 or greater" })),
  windowUnit: enumSchema(USAGE_LIMIT_WINDOW_UNITS),
  timeZone: Schema.NullOr(TimeZoneSchema),
}).check(
  Schema.makeFilter((fields) => {
    const amountPattern = fields.metric === "tokens" ? TOKEN_AMOUNT_PATTERN : SPEND_AMOUNT_PATTERN
    if (!amountPattern.test(fields.amount) || Number(fields.amount) <= 0)
      return {
        path: ["amount"],
        issue:
          fields.metric === "tokens"
            ? "Enter a whole number of tokens"
            : "Enter a dollar amount above zero with at most two decimal places",
      }
    if (fields.windowCount > USAGE_LIMIT_MAX_WINDOW_COUNTS[fields.windowUnit])
      return { path: ["windowCount"], issue: "Windows can be at most one year long" }
    if ((fields.windowType === "fixed") !== (fields.timeZone !== null))
      return { path: ["timeZone"], issue: "Select a time zone for fixed windows only" }
    if (fields.scope === "global" && !fields.appliesByDefault)
      return { path: ["appliesByDefault"], issue: "Global limits apply to every tenant user" }
    return undefined
  }),
)

export type UsageLimitFields = typeof UsageLimitFieldsSchema.Type

export function formatUsageLimitId(key: { organizationId: string; id: string }): string {
  return `limit_${key.organizationId}_${key.id}`
}

/** A parsed organization ID identifies a limit's owner, but never authorizes access to it. */
export function parseUsageLimitId(value: unknown): { organizationId: string; id: string } | null {
  const match = typeof value === "string" ? USAGE_LIMIT_ID_PATTERN.exec(value) : null
  return match ? { organizationId: match[1]!, id: match[2]! } : null
}
