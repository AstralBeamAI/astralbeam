import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm"

import { usageLimitCounter } from "@/db/schema/usage-limits"
import type { UsageLimitFields } from "./schemas.ts"

/** Whose usage a chat request spends: its tenant user, their tenant, and the conversation if any. */
export interface UsageSubject {
  readonly organizationId: string
  readonly tenantId: string
  readonly tenantUserId: string
  readonly threadId?: string | undefined
}

type CounterKey = { tenantId: string | null; tenantUserId: string | null; threadId: string | null }

/** The counter a limit keeps for a subject, or null for a conversation limit outside a conversation. */
export function usageCounterKey(
  scope: UsageLimitFields["scope"],
  subject: UsageSubject,
): CounterKey | null {
  const none = { tenantId: null, tenantUserId: null, threadId: null }
  if (scope === "global") return none
  if (scope === "tenant") return { ...none, tenantId: subject.tenantId }
  if (scope === "tenant_user")
    return { ...none, tenantId: subject.tenantId, tenantUserId: subject.tenantUserId }
  return subject.threadId
    ? { ...none, tenantId: subject.tenantId, threadId: subject.threadId }
    : null
}

function matchesColumn(column: typeof usageLimitCounter.tenantId, value: string | null) {
  return value === null ? isNull(column) : eq(column, value)
}

/** Selects each limit's counter for its own subject columns. */
export function usageCountersWhere(
  organizationId: string,
  keys: readonly { usageLimitId: string; key: CounterKey }[],
): SQL | undefined {
  return and(
    eq(usageLimitCounter.organizationId, organizationId),
    or(
      ...keys.map(({ usageLimitId, key }) =>
        and(
          eq(usageLimitCounter.usageLimitId, usageLimitId),
          matchesColumn(usageLimitCounter.tenantId, key.tenantId),
          matchesColumn(usageLimitCounter.tenantUserId, key.tenantUserId),
          matchesColumn(usageLimitCounter.threadId, key.threadId),
        ),
      ),
    ),
  )
}

/** Adds to a live window, or restarts one that ended at or before `staleAt` with only this usage. */
export function usageCounterIncrement(staleAt: Date) {
  const live = sql`${usageLimitCounter.windowStartsAt} > ${staleAt.toISOString()}::timestamptz`
  return {
    windowStartsAt: sql`case when ${live} then ${usageLimitCounter.windowStartsAt} else excluded.window_starts_at end`,
    tokens: sql`case when ${live} then ${usageLimitCounter.tokens} + excluded.tokens else excluded.tokens end`,
    spend: sql`case when ${live} then ${usageLimitCounter.spend} + excluded.spend else excluded.spend end`,
    // Drizzle's `updatedAt` hook runs for update statements, not for a conflict clause.
    updatedAt: sql`now()`,
  }
}
