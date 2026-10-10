import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  index,
  pgEnum,
  snakeCase,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { deferrableForeignKey, timestamps, uuidV7PrimaryKey } from "../lib/columns.ts"

import { user } from "./authentication.ts"
import { organization } from "./organizations.ts"

// pending: upload not yet verified. stored: uploaded and verified, with or without an attachment.
// purging: S3 content and metadata are being removed.
const fileObjectStatus = pgEnum("file_object_status", ["pending", "stored", "purging"])

export const fileObject = snakeCase.table(
  "file_object",
  {
    id: uuidV7PrimaryKey(),
    objectKey: text().notNull(),
    contentType: text().notNull(),
    byteSize: bigint({ mode: "number" }).notNull(),
    sha256: text().notNull(),
    status: fileObjectStatus().notNull().default("pending"),
    userId: uuid(),
    organizationId: uuid(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("file_object_key_uidx").on(table.objectKey),
    index("file_object_status_created_at_idx").on(table.status, table.createdAt),
    uniqueIndex("file_object_user_id_uidx").on(table.userId, table.id),
    uniqueIndex("file_object_organization_id_uidx").on(table.organizationId, table.id),
    check(
      "file_object_profile_owner_check",
      sql`${table.userId} is null or ${table.organizationId} is null`,
    ),
    deferrableForeignKey({ columns: [table.userId], foreignColumns: [user.id] }).onDelete(
      "set null",
    ),
    deferrableForeignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("set null"),
  ],
)

/** @knipignore Drizzle Kit discovers enums through schema.ts. */
export { fileObjectStatus }
