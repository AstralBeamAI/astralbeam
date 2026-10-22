import { boolean, index, primaryKey, snakeCase, text, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { Schema } from "effect"

import {
  encryptedJson,
  deferrableForeignKey,
  timestamps,
  timestampWithTimeZone,
  uuidV7,
} from "../lib/columns"
import { SandboxProviderConfigurationSchema } from "@/lib/sandboxes/schemas"
import { UuidV7Schema } from "@/lib/schemas"
import { organization } from "./organizations"

const SandboxResourceConfigurationSchema = Schema.Struct({
  organizationId: UuidV7Schema,
  resourceId: UuidV7Schema,
  providerSandboxId: Schema.String,
  configuration: SandboxProviderConfigurationSchema,
})

export const sandboxResource = snakeCase.table(
  "sandbox_resource",
  {
    organizationId: uuid().notNull(),
    id: uuidV7(),
    ownerId: uuid().notNull(),
    providerSandboxId: text().notNull(),
    configuration: encryptedJson({ schema: SandboxResourceConfigurationSchema }).notNull(),
    settled: boolean().notNull().default(false),
    retiredAt: timestampWithTimeZone(),
    expiresAt: timestampWithTimeZone().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    uniqueIndex("sandbox_resource_provider_id_uidx").on(
      table.organizationId,
      table.providerSandboxId,
    ),
    index("sandbox_resource_expires_at_idx").on(table.expiresAt),
    index("sandbox_resource_owner_id_idx").on(table.ownerId),
    deferrableForeignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("no action"),
  ],
)
