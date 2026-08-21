import { defineRelationsPart } from "drizzle-orm"
import {
  bigint,
  boolean,
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import {
  caseInsensitiveText,
  timestamps,
  timestampWithTimeZone,
  uuidV7PrimaryKey,
} from "./postgresql-types.server"

export const user = snakeCase.table("user", {
  id: uuidV7PrimaryKey(),
  name: text().notNull(),
  email: caseInsensitiveText().notNull().unique(),
  emailVerified: boolean().default(false).notNull(),
  image: text(),
  ...timestamps(),
  termsAcceptedAt: timestampWithTimeZone().defaultNow().notNull(),
  termsVersion: text().notNull(),
})

export const session = snakeCase.table(
  "session",
  {
    id: uuidV7PrimaryKey(),
    expiresAt: timestampWithTimeZone().notNull(),
    token: text().notNull().unique(),
    ...timestamps(),
    ipAddress: text(),
    userAgent: text(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: uuid(),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
)

export const account = snakeCase.table(
  "account",
  {
    id: uuidV7PrimaryKey(),
    issuer: text().notNull(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
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

export const organization = snakeCase.table(
  "organization",
  {
    id: uuidV7PrimaryKey(),
    name: text().notNull(),
    slug: text().notNull(),
    logo: text(),
    ...timestamps(),
    metadata: text(),
  },
  (table) => [uniqueIndex("organization_slug_uidx").on(table.slug)],
)

export const member = snakeCase.table(
  "member",
  {
    id: uuidV7PrimaryKey(),
    organizationId: uuid()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text().default("member").notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("member_organization_id_user_id_uidx").on(
      table.organizationId,
      table.userId,
    ),
    index("member_organization_id_idx").on(table.organizationId),
    index("member_user_id_idx").on(table.userId),
  ],
)

export const invitation = snakeCase.table(
  "invitation",
  {
    id: uuidV7PrimaryKey(),
    organizationId: uuid()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: caseInsensitiveText().notNull(),
    role: text(),
    status: text().default("pending").notNull(),
    expiresAt: timestampWithTimeZone().notNull(),
    ...timestamps(),
    inviterId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_organization_id_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
)

export const rateLimit = snakeCase.table("rate_limit", {
  id: uuidV7PrimaryKey(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  lastRequest: bigint({ mode: "number" }).notNull(),
  ...timestamps(),
})

export const authRelations = defineRelationsPart(
  { account, invitation, member, organization, rateLimit, session, user, verification },
  (r) => ({
    user: {
      sessions: r.many.session({ from: r.user.id, to: r.session.userId }),
      accounts: r.many.account({ from: r.user.id, to: r.account.userId }),
      members: r.many.member({ from: r.user.id, to: r.member.userId }),
      invitations: r.many.invitation({ from: r.user.id, to: r.invitation.inviterId }),
    },
    session: { user: r.one.user({ from: r.session.userId, to: r.user.id }) },
    account: { user: r.one.user({ from: r.account.userId, to: r.user.id }) },
    organization: {
      members: r.many.member({ from: r.organization.id, to: r.member.organizationId }),
      invitations: r.many.invitation({
        from: r.organization.id,
        to: r.invitation.organizationId,
      }),
    },
    member: {
      organization: r.one.organization({
        from: r.member.organizationId,
        to: r.organization.id,
      }),
      user: r.one.user({ from: r.member.userId, to: r.user.id }),
    },
    invitation: {
      organization: r.one.organization({
        from: r.invitation.organizationId,
        to: r.organization.id,
      }),
      user: r.one.user({ from: r.invitation.inviterId, to: r.user.id }),
    },
  }),
)
