import {
  bigint,
  index,
  pgEnum,
  primaryKey,
  snakeCase,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import type { PgTableExtraConfigValue } from "drizzle-orm/pg-core"

import { deferrableForeignKey, timestamps, uuidV7 } from "../lib/columns.ts"
import { organization } from "./organizations.ts"

// pending: upload not yet verified. stored: uploaded and verified, with or without an attachment.
// purging: S3 content and metadata are being removed.
const fileObjectStatus = pgEnum("file_object_status", ["pending", "stored", "purging"])

export const fileObject = snakeCase.table(
  "file_object",
  {
    organizationId: uuid().notNull(),
    id: uuidV7(),
    objectKey: text().notNull(),
    contentType: text().notNull(),
    byteSize: bigint({ mode: "number" }).notNull(),
    sha256: text().notNull(),
    status: fileObjectStatus().notNull().default("pending"),
    ...timestamps(),
  },
  (table): PgTableExtraConfigValue[] => [
    primaryKey({ name: "file_object_pkey", columns: [table.organizationId, table.id] }),
    uniqueIndex("file_object_key_uidx").on(table.objectKey),
    index("file_object_status_created_at_idx").on(table.status, table.createdAt),
    deferrableForeignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
  ],
)

/** @knipignore Drizzle Kit discovers enums through schema.ts. */
export { fileObjectStatus }
