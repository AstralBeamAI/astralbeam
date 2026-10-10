import { fileObject } from "./files.ts"
import { sql } from "drizzle-orm"

import { boolean, check, index, snakeCase, text, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import type { PgTableExtraConfigValue } from "drizzle-orm/pg-core"

import {
  caseInsensitiveText,
  deferrableForeignKey,
  timestamps,
  timestampWithTimeZone,
  uuidV7PrimaryKey,
} from "../lib/columns.ts"

export const user = snakeCase.table(
  "user",
  {
    id: uuidV7PrimaryKey(),
    name: text().notNull(),
    email: caseInsensitiveText().notNull(),
    emailVerified: boolean().default(false).notNull(),
    image: text(),
    avatarFileId: uuid(),
    termsAcceptedAt: timestampWithTimeZone(),
    ...timestamps(),
  },
  (table): PgTableExtraConfigValue[] => [
    uniqueIndex("user_email_uidx").on(table.email),
    check(
      "user_avatar_url_check",
      sql`${table.image} is not distinct from '/api/files/avatars/' || ${table.avatarFileId}`,
    ),
    deferrableForeignKey({
      name: "user_avatar_current_fk",
      columns: [table.id, table.avatarFileId],
      foreignColumns: [fileObject.userId, fileObject.id],
    }),
  ],
)

export const session = snakeCase.table(
  "session",
  {
    id: uuidV7PrimaryKey(),
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
    id: uuidV7PrimaryKey(),
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
    id: uuidV7PrimaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestampWithTimeZone().notNull(),
    ...timestamps(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
)
