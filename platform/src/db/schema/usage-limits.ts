import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  integer,
  numeric,
  pgEnum,
  primaryKey,
  snakeCase,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import {
  deferrableForeignKey,
  lockVersion,
  timestamps,
  timestampWithTimeZone,
  uuidV7,
} from "../lib/columns.ts"
import { chatThread } from "./chat.ts"
import { organization, tenant, tenantUser } from "./organizations.ts"

const usageLimitScopeEnum = pgEnum("usage_limit_scope", [
  "global",
  "tenant",
  "tenant_user",
  "thread",
])
const usageLimitMetricEnum = pgEnum("usage_limit_metric", ["tokens", "spend"])
const usageLimitWindowTypeEnum = pgEnum("usage_limit_window_type", ["fixed", "rolling"])
const usageLimitWindowUnitEnum = pgEnum("usage_limit_window_unit", [
  "minute",
  "hour",
  "day",
  "week",
  "month",
])

/**
 * A token or spend budget over a window, counted per scope subject. Default limits apply to every chat
 * token. Others apply only when a token lists their public ID. Global limits are always defaults.
 */
export const usageLimit = snakeCase.table(
  "usage_limit",
  {
    organizationId: uuid().notNull(),
    id: uuidV7(),
    // Shown to tenant users when the limit blocks them, so plans may share a name such as "Weekly limit".
    name: text().notNull(),
    enabled: boolean().notNull(),
    appliesByDefault: boolean().notNull(),
    scope: usageLimitScopeEnum().notNull(),
    metric: usageLimitMetricEnum().notNull(),
    // Whole tokens, or US dollars for spend.
    amount: numeric({ mode: "string" }).notNull(),
    // Fixed windows align to the calendar in timeZone. Rolling windows start at first use.
    windowType: usageLimitWindowTypeEnum().notNull(),
    windowCount: integer().notNull(),
    windowUnit: usageLimitWindowUnitEnum().notNull(),
    timeZone: text(),
    lockVersion: lockVersion(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "usage_limit_pkey", columns: [table.organizationId, table.id] }),
    check("usage_limit_name_length_check", sql`char_length(${table.name}) between 1 and 100`),
    check(
      "usage_limit_amount_check",
      sql`${table.amount} > 0 and (${table.metric} = 'spend' or ${table.amount} = trunc(${table.amount}))`,
    ),
    check("usage_limit_window_count_check", sql`${table.windowCount} > 0`),
    check(
      "usage_limit_time_zone_check",
      sql`(${table.windowType} = 'fixed') = (${table.timeZone} is not null)`,
    ),
    check(
      "usage_limit_global_default_check",
      sql`${table.scope} <> 'global' or ${table.appliesByDefault}`,
    ),
    deferrableForeignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
  ],
)

/**
 * One subject's usage in its current window of a limit. Global counters name no subject, and the
 * others name the tenant plus its tenant user or conversation, whose deletion removes the counter.
 */
export const usageLimitCounter = snakeCase.table(
  "usage_limit_counter",
  {
    organizationId: uuid().notNull(),
    id: uuidV7(),
    usageLimitId: uuid().notNull(),
    tenantId: uuid(),
    tenantUserId: uuid(),
    threadId: uuid(),
    // Recording usage at or after this end starts a new window with only the new usage.
    windowEndsAt: timestampWithTimeZone().notNull(),
    tokens: bigint({ mode: "number" }).notNull(),
    // US dollars at each model's configured price when the usage was recorded.
    spend: numeric({ mode: "string" }).notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "usage_limit_counter_pkey", columns: [table.organizationId, table.id] }),
    // https://www.postgresql.org/docs/18/sql-createtable.html#SQL-CREATETABLE-PARMS-UNIQUE
    unique("usage_limit_counter_subject_key")
      .on(
        table.organizationId,
        table.usageLimitId,
        table.tenantId,
        table.tenantUserId,
        table.threadId,
      )
      .nullsNotDistinct(),
    check(
      "usage_limit_counter_subject_check",
      sql`(${table.tenantId} is not null or (${table.tenantUserId} is null and ${table.threadId} is null)) and (${table.tenantUserId} is null or ${table.threadId} is null)`,
    ),
    deferrableForeignKey({
      name: "usage_limit_counter_usage_limit_fk",
      columns: [table.organizationId, table.usageLimitId],
      foreignColumns: [usageLimit.organizationId, usageLimit.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      name: "usage_limit_counter_tenant_fk",
      columns: [table.organizationId, table.tenantId],
      foreignColumns: [tenant.organizationId, tenant.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      name: "usage_limit_counter_tenant_user_fk",
      columns: [table.organizationId, table.tenantId, table.tenantUserId],
      foreignColumns: [tenantUser.organizationId, tenantUser.tenantId, tenantUser.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      name: "usage_limit_counter_thread_fk",
      columns: [table.organizationId, table.tenantId, table.threadId],
      foreignColumns: [chatThread.organizationId, chatThread.tenantId, chatThread.id],
    }).onDelete("cascade"),
  ],
)

/** @knipignore Drizzle Kit discovers these enums through schema.ts. */
export {
  usageLimitScopeEnum,
  usageLimitMetricEnum,
  usageLimitWindowTypeEnum,
  usageLimitWindowUnitEnum,
}
