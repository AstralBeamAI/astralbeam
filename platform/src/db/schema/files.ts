import { bigint, index, pgEnum, uniqueIndex } from "drizzle-orm/pg-core"

import { timestamps, uuidV7, text } from "../lib/columns.ts"
import { organizationForeignKey } from "./organizations.ts"
import { defineModel, primaryKey } from "@/lib/persistence.server"

// pending: upload not yet verified. stored: uploaded and verified, with or without an attachment.
// purging: S3 content and metadata are being removed.
const fileObjectStatus = pgEnum("file_object_status", ["pending", "stored", "purging"])

export const fileObject = defineModel(
  "file_object",
  {
    organizationId: uuidV7({ generated: false }).notNull(),
    id: uuidV7(),
    objectKey: text().notNull(),
    contentType: text().notNull(),
    byteSize: bigint({ mode: "number" }).notNull(),
    sha256: text().notNull(),
    status: fileObjectStatus().notNull().default("pending"),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "file_object_pkey", columns: [table.organizationId, table.id] }),
    uniqueIndex("file_object_key_uidx").on(table.objectKey),
    index("file_object_status_created_at_idx").on(table.status, table.createdAt),
    organizationForeignKey(table),
  ],
)

/** @knipignore Drizzle Kit discovers enums through schema.ts. */
export { fileObjectStatus }
