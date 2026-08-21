import { defineRelationsPart, sql } from "drizzle-orm"
import { index, pgEnum, snakeCase, uniqueIndex, uuid } from "drizzle-orm/pg-core"

import { organization, user } from "./auth-schema.server"
import {
  caseInsensitiveText,
  timestamps,
  timestampWithTimeZone,
  uuidV7PrimaryKey,
} from "./postgresql-types.server"

export const organizationAccessRole = pgEnum("organization_access_role", ["member", "admin"])
export const organizationAccessStatus = pgEnum("organization_access_status", [
  "pending",
  "active",
  "revoked",
])

export const organizationAccessGrant = snakeCase.table(
  "organization_access_grant",
  {
    id: uuidV7PrimaryKey(),
    organizationId: uuid()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: caseInsensitiveText().notNull(),
    requestedRole: organizationAccessRole().notNull(),
    status: organizationAccessStatus().default("pending").notNull(),
    activatedUserId: uuid().references(() => user.id, {
      onDelete: "set null",
    }),
    createdByUserId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    ...timestamps(),
    activatedAt: timestampWithTimeZone(),
    revokedAt: timestampWithTimeZone(),
  },
  (table) => [
    uniqueIndex("organization_access_grant_open_email_uidx")
      .on(table.organizationId, table.email)
      .where(sql`${table.status} <> 'revoked'`),
    index("organization_access_grant_email_status_idx").on(
      table.email,
      table.status,
    ),
    index("organization_access_grant_organization_status_idx").on(
      table.organizationId,
      table.status,
    ),
  ],
)

export const organizationAccessRelations = defineRelationsPart(
  { organization, organizationAccessGrant, user },
  (r) => ({
    organizationAccessGrant: {
      organization: r.one.organization({
        from: r.organizationAccessGrant.organizationId,
        to: r.organization.id,
      }),
      activatedUser: r.one.user({
        from: r.organizationAccessGrant.activatedUserId,
        to: r.user.id,
        optional: true,
        alias: "activatedUser",
      }),
      createdByUser: r.one.user({
        from: r.organizationAccessGrant.createdByUserId,
        to: r.user.id,
        alias: "createdByUser",
      }),
    },
  }),
)
