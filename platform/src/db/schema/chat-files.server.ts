import { primaryKey, snakeCase, uniqueIndex, uuid } from "drizzle-orm/pg-core"

import { deferrableForeignKey, timestamps } from "../lib/columns.server.ts"
import { chatThread } from "./chat.server.ts"
import { fileObject } from "./files.server.ts"

export const chatFile = snakeCase.table(
  "chat_file",
  {
    organizationId: uuid().notNull(),
    tenantId: uuid().notNull(),
    threadId: uuid().notNull(),
    id: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.tenantId, table.threadId, table.id] }),
    uniqueIndex("chat_file_object_uidx").on(table.id),
    deferrableForeignKey({
      columns: [table.organizationId, table.tenantId, table.threadId],
      foreignColumns: [chatThread.organizationId, chatThread.tenantId, chatThread.id],
    }).onDelete("cascade"),
    deferrableForeignKey({ columns: [table.id], foreignColumns: [fileObject.id] }).onDelete(
      "cascade",
    ),
  ],
)
