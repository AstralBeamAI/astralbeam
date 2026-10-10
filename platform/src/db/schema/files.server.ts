import { sql } from "drizzle-orm"
import {
  bigint,
  pgEnum,
  check,
  index,
  primaryKey,
  snakeCase,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import {
  deferrableForeignKey,
  timestamps,
  timestampWithTimeZone,
  uuidV7PrimaryKey,
  uuidV7,
} from "../lib/columns.server.ts"
import { user } from "./authentication.server.ts"
import { organization } from "./organizations.server.ts"

const userAvatarSourceKind = pgEnum("user_avatar_source_kind", ["manual", "external", "gravatar"])
const profileImageImportStatus = pgEnum("profile_image_import_status", [
  "pending",
  "imported",
  "unavailable",
  "disabled",
  "superseded",
])

// Physical objects are global infrastructure. Scoped associations below own and authorize files.
export const fileObject = snakeCase.table(
  "file_object",
  {
    id: uuidV7PrimaryKey(),
    objectKey: text().notNull(),
    contentType: text().notNull(),
    byteSize: bigint({ mode: "number" }).notNull(),
    sha256: text().notNull(),
    sourceIdentity: text(),
    verifiedAt: timestampWithTimeZone(),
    expiresAt: timestampWithTimeZone().default(sql`now() + interval '24 hours'`),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("file_object_key_uidx").on(table.objectKey),
    uniqueIndex("file_object_source_identity_uidx").on(table.sourceIdentity),
    check("file_object_size_check", sql`${table.byteSize} >= 0`),
    check("file_object_sha256_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    index("file_object_expiry_idx").on(table.expiresAt),
  ],
)

export const userAvatar = snakeCase.table(
  "user_avatar",
  {
    userId: uuid().notNull(),
    id: uuid().notNull(),
    sourceKind: userAvatarSourceKind().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "user_avatar_pkey", columns: [table.userId, table.id] }),
    uniqueIndex("user_avatar_file_uidx").on(table.id),
    deferrableForeignKey({ columns: [table.userId], foreignColumns: [user.id] }).onDelete(
      "cascade",
    ),
    deferrableForeignKey({ columns: [table.id], foreignColumns: [fileObject.id] }).onDelete(
      "cascade",
    ),
  ],
)

export const organizationLogo = snakeCase.table(
  "organization_logo",
  {
    organizationId: uuid().notNull(),
    id: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "organization_logo_pkey", columns: [table.organizationId, table.id] }),
    uniqueIndex("organization_logo_file_uidx").on(table.id),
    deferrableForeignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
    deferrableForeignKey({ columns: [table.id], foreignColumns: [fileObject.id] }).onDelete(
      "cascade",
    ),
  ],
)

export const userImageImport = snakeCase.table(
  "user_image_import",
  {
    userId: uuid().primaryKey(),
    sourceUrl: text(),
    expectedImage: text(),
    generation: uuid()
      .notNull()
      .default(sql`uuidv7()`),
    status: profileImageImportStatus().notNull(),
    reason: text(),
    attempts: bigint({ mode: "number" }).notNull().default(0),
    retryAt: timestampWithTimeZone().notNull().defaultNow(),
    ...timestamps(),
  },
  (table) => [
    deferrableForeignKey({ columns: [table.userId], foreignColumns: [user.id] }).onDelete(
      "cascade",
    ),
    index("user_image_import_retry_idx")
      .on(table.retryAt)
      .where(sql`${table.status} = 'pending'`),
  ],
)

export const organizationImageImport = snakeCase.table(
  "organization_image_import",
  {
    organizationId: uuid().notNull(),
    id: uuidV7(),
    sourceUrl: text(),
    expectedLogo: text(),
    generation: uuid()
      .notNull()
      .default(sql`uuidv7()`),
    status: profileImageImportStatus().notNull(),
    reason: text(),
    attempts: bigint({ mode: "number" }).notNull().default(0),
    retryAt: timestampWithTimeZone().notNull().defaultNow(),
    ...timestamps(),
  },
  (table) => [
    deferrableForeignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
    primaryKey({
      name: "organization_image_import_pkey",
      columns: [table.organizationId, table.id],
    }),
    uniqueIndex("organization_image_import_owner_uidx").on(table.organizationId),
    index("organization_image_import_retry_idx")
      .on(table.retryAt)
      .where(sql`${table.status} = 'pending'`),
  ],
)

// A deletion target has no owner FK, so SQL cascades cannot erase pending object cleanup.
export const fileDeletion = snakeCase.table(
  "file_deletion",
  {
    id: uuidV7PrimaryKey(),
    objectKey: text().notNull(),
    retryAt: timestampWithTimeZone()
      .notNull()
      .default(sql`now() + interval '1 minute'`),
    attempts: bigint({ mode: "number" }).notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("file_deletion_key_uidx").on(table.objectKey),
    index("file_deletion_retry_idx").on(table.retryAt),
  ],
)

/** @knipignore Drizzle Kit discovers these enums through schema.server.ts. */
export { userAvatarSourceKind, profileImageImportStatus }
