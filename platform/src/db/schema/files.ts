import { bigint, index, pgEnum, snakeCase, text, uniqueIndex } from "drizzle-orm/pg-core"

import { timestamps, uuidV7PrimaryKey } from "../lib/columns.ts"

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
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("file_object_key_uidx").on(table.objectKey),
    index("file_object_status_created_at_idx").on(table.status, table.createdAt),
  ],
)

/** @knipignore Drizzle Kit discovers enums through schema.ts. */
export { fileObjectStatus }
