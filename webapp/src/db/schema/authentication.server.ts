import { boolean, index, snakeCase, text, uniqueIndex, uuid } from "drizzle-orm/pg-core"

import {
  caseInsensitiveText,
  timestamps,
  timestampWithTimeZone,
  uuidV7PrimaryKey,
} from "../postgresql-types.server.ts"

export const user = snakeCase.table(
  "user",
  {
    id: uuidV7PrimaryKey(),
    name: text().notNull(),
    email: caseInsensitiveText().notNull(),
    emailVerified: boolean().default(false).notNull(),
    image: text(),
    termsAcceptedAt: timestampWithTimeZone(),
    ...timestamps(),
  },
  (table) => [uniqueIndex("user_email_uidx").on(table.email)],
)

export const session = snakeCase.table(
  "session",
  {
    id: uuidV7PrimaryKey(),
    expiresAt: timestampWithTimeZone().notNull(),
    token: text().notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
    // Better Auth defines the active organization as a nullable session selector without a foreign key; memberships stay authoritative and stale selections are reconciled on access. https://github.com/better-auth/better-auth/blob/v1.7.1/packages/better-auth/src/plugins/organization/schema.ts#L212-L218
    activeOrganizationId: uuid(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("session_token_uidx").on(table.token),
    index("session_user_id_idx").on(table.userId),
  ],
)

export const account = snakeCase.table(
  "account",
  {
    id: uuidV7PrimaryKey(),
    issuer: text().notNull(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestampWithTimeZone(),
    refreshTokenExpiresAt: timestampWithTimeZone(),
    scope: text(),
    password: text(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("account_issuer_account_id_uidx").on(table.issuer, table.accountId),
    index("account_user_id_idx").on(table.userId),
  ],
)

export const verification = snakeCase.table(
  "verification",
  {
    id: uuidV7PrimaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestampWithTimeZone().notNull(),
    ...timestamps(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
)
