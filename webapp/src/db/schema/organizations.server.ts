import { index, snakeCase, text, uniqueIndex, uuid } from "drizzle-orm/pg-core"

import {
  caseInsensitiveText,
  lockVersion,
  timestamps,
  timestampWithTimeZone,
  uuidV7PrimaryKey,
} from "../lib/postgresql-types.server.ts"
import { user } from "./authentication.server.ts"

export const organization = snakeCase.table(
  "organization",
  {
    id: uuidV7PrimaryKey(),
    name: text().notNull(),
    slug: text().notNull(),
    logo: text(),
    metadata: text(),
    ...timestamps(),
  },
  (table) => [uniqueIndex("organization_slug_uidx").on(table.slug)],
)

export const organizationConfiguration = snakeCase.table(
  "organization_configuration",
  {
    id: uuidV7PrimaryKey(),
    organizationId: uuid().notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    lockVersion: lockVersion(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("organization_configuration_organization_id_uidx").on(table.organizationId),
  ],
)

export const member = snakeCase.table(
  "member",
  {
    id: uuidV7PrimaryKey(),
    organizationId: uuid().notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    userId: uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
    role: text().default("viewer").notNull(),
    ...timestamps(),
  },
  (table) => [
    // Keep Better Auth's generated member shape: organization and user are referenced independently, while its official APIs enforce membership creation. https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/organization/schema.ts#L140-L166
    index("member_organization_id_idx").on(table.organizationId),
    index("member_user_id_idx").on(table.userId),
  ],
)

export const invitation = snakeCase.table(
  "invitation",
  {
    id: uuidV7PrimaryKey(),
    organizationId: uuid().notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    email: caseInsensitiveText().notNull(),
    role: text(),
    status: text().default("pending").notNull(),
    expiresAt: timestampWithTimeZone().notNull(),
    inviterId: uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (table) => [
    index("invitation_organization_id_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
)
