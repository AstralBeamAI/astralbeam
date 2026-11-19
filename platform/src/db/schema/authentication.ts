import { boolean, index, uniqueIndex, primaryKey, snakeCase, uuid } from "drizzle-orm/pg-core"

import {
  caseInsensitiveText,
  deferrableForeignKey,
  timestamps,
  timestampWithTimeZone,
  uuidV7,
  text,
} from "../lib/columns.ts"

export const user = snakeCase.table(
  "user",
  {
    id: uuidV7(),
    name: text().notNull(),
    email: caseInsensitiveText().notNull(),
    emailVerified: boolean().default(false).notNull(),
    // Better Auth requires this column. Keep it null and use member.avatarFileId for avatars.
    // https://better-auth.com/docs/concepts/database#core-schema
    image: text(),
    termsAcceptedAt: timestampWithTimeZone(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "user_pkey", columns: [table.id] }),
    uniqueIndex("user_email_uidx").on(table.email),
  ],
)

export const session = snakeCase.table(
  "session",
  {
    id: uuidV7(),
    expiresAt: timestampWithTimeZone().notNull(),
    token: text().notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: uuid().notNull(),
    // Better Auth defines the active organization as a nullable session selector without a foreign key; memberships stay authoritative and stale selections are reconciled on access. https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/organization/schema.ts#L212-L218
    activeOrganizationId: uuid(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "session_pkey", columns: [table.id] }),
    uniqueIndex("session_token_uidx").on(table.token),
    index("session_user_id_idx").on(table.userId),
    deferrableForeignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
    }).onDelete("cascade"),
  ],
)

export const account = snakeCase.table(
  "account",
  {
    id: uuidV7(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: uuid().notNull(),
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
    primaryKey({ name: "account_pkey", columns: [table.id] }),
    uniqueIndex("account_provider_id_account_id_uidx").on(table.providerId, table.accountId),
    index("account_user_id_idx").on(table.userId),
    deferrableForeignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
    }).onDelete("cascade"),
  ],
)

export const verification = snakeCase.table(
  "verification",
  {
    id: uuidV7(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestampWithTimeZone().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "verification_pkey", columns: [table.id] }),
    index("verification_identifier_idx").on(table.identifier),
  ],
)
