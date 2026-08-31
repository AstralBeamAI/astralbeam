import { boolean, index, integer, snakeCase, text, uniqueIndex, uuid } from "drizzle-orm/pg-core"

import {
  caseInsensitiveText,
  lockVersion,
  timestamps,
  timestampWithTimeZone,
  uuidV7PrimaryKey,
} from "../lib/columns.server.ts"
import {
  ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS,
  ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS,
} from "../../lib/auth/organization-api-key-configuration.ts"
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

export const apiKey = snakeCase.table(
  "api_key",
  {
    id: uuidV7PrimaryKey(),
    configId: text().default("default").notNull(),
    name: text().notNull(),
    start: text(),
    organizationId: uuid().notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    prefix: text(),
    // Better Auth stores a SHA-256 digest, not the bearer key. https://better-auth.com/docs/plugins/api-key/reference#schema
    key: text().notNull(),
    refillInterval: integer(),
    refillAmount: integer(),
    lastRefillAt: timestampWithTimeZone(),
    enabled: boolean().default(true).notNull(),
    rateLimitEnabled: boolean().default(true).notNull(),
    rateLimitTimeWindow: integer().default(ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS).notNull(),
    rateLimitMax: integer().default(ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS).notNull(),
    requestCount: integer().default(0).notNull(),
    remaining: integer(),
    lastRequest: timestampWithTimeZone(),
    expiresAt: timestampWithTimeZone(),
    permissions: text(),
    metadata: text(),
    ...timestamps(),
  },
  (table) => [
    index("api_key_config_id_idx").on(table.configId),
    index("api_key_organization_id_idx").on(table.organizationId),
    index("api_key_key_idx").on(table.key),
  ],
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
