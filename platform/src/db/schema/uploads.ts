import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  pgEnum,
  primaryKey,
  snakeCase,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { deferrableForeignKey, timestamps, timestampWithTimeZone, uuidV7 } from "../lib/columns"
import { fileObject } from "./files"
import { tenantUser, type OrganizationId, type TenantId, type TenantUserId } from "./organizations"

const fileUploadStatus = pgEnum("file_upload_status", [
  "preparing",
  "pending",
  "completing",
  "completed",
  "cancelled",
])

export const fileUpload = snakeCase.table(
  "file_upload",
  {
    organizationId: uuid().$type<OrganizationId>().notNull(),
    tenantId: uuid().$type<TenantId>().notNull(),
    id: uuidV7(),
    tenantUserId: uuid().$type<TenantUserId>().notNull(),
    prepareKey: uuid().notNull(),
    fileId: uuid().notNull(),
    objectKey: text().notNull(),
    uploadId: text(),
    filename: text().notNull(),
    contentType: text().notNull(),
    byteSize: integer().notNull(),
    sha256: text().notNull(),
    status: fileUploadStatus().notNull().default("preparing"),
    expiresAt: timestampWithTimeZone()
      .notNull()
      .default(sql`now() + interval '24 hours'`),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.tenantId, table.id] }),
    uniqueIndex("file_upload_prepare_key_uidx").on(
      table.organizationId,
      table.tenantId,
      table.tenantUserId,
      table.prepareKey,
    ),
    uniqueIndex("file_upload_object_key_uidx").on(table.objectKey),
    uniqueIndex("file_upload_file_uidx").on(table.organizationId, table.fileId),
    index("file_upload_expiry_idx").on(table.expiresAt),
    deferrableForeignKey({
      columns: [table.organizationId, table.tenantId, table.tenantUserId],
      foreignColumns: [tenantUser.organizationId, tenantUser.tenantId, tenantUser.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      columns: [table.organizationId, table.fileId],
      foreignColumns: [fileObject.organizationId, fileObject.id],
    }).onDelete("cascade"),
    check("file_upload_size_check", sql`${table.byteSize} > 0 and ${table.byteSize} <= 20971520`),
    check("file_upload_sha256_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
)

/** @knipignore Drizzle Kit discovers enums through schema.ts. */
export { fileUploadStatus }
