import { index, unique, primaryKey, snakeCase, uuid } from "drizzle-orm/pg-core"
import {
  deferrableForeignKey,
  encryptedJson,
  lockVersion,
  jsonb,
  timestamps,
  uuidV7,
  text,
} from "../lib/columns.ts"
import type { OrganizationId, TenantId, TenantUserId } from "./organizations.ts"
import { organizationForeignKey, tenantUserForeignKey } from "./organizations.ts"
import { McpCredentialEnvelopeSchema, McpStoredAuthConfigSchema } from "@/lib/mcp/schemas.ts"

export const mcpServer = snakeCase.table(
  "mcp_server",
  {
    organizationId: uuid().$type<OrganizationId>().notNull(),
    id: uuidV7(),
    endpointUrl: text().notNull(),
    authConfig: jsonb({ schema: McpStoredAuthConfigSchema }).notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.id] }),
    unique("mcp_server_endpoint_uidx").on(t.organizationId, t.endpointUrl),
    organizationForeignKey(t),
  ],
)

export const mcpConnection = snakeCase.table(
  "mcp_connection",
  {
    organizationId: uuid().$type<OrganizationId>().notNull(),
    tenantId: uuid().$type<TenantId>().notNull(),
    id: uuidV7(),
    tenantUserId: uuid().$type<TenantUserId>().notNull(),
    mcpServerId: uuid().notNull(),
    credentials: encryptedJson({ schema: McpCredentialEnvelopeSchema }),
    lockVersion: lockVersion(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.tenantId, t.id] }),
    unique("mcp_connection_owner_server_uidx").on(
      t.organizationId,
      t.tenantId,
      t.tenantUserId,
      t.mcpServerId,
    ),
    index("mcp_connection_server_idx").on(t.organizationId, t.mcpServerId),
    tenantUserForeignKey(t).onDelete("cascade"),
    deferrableForeignKey({
      columns: [t.organizationId, t.mcpServerId],
      foreignColumns: [mcpServer.organizationId, mcpServer.id],
    }).onDelete("cascade"),
  ],
)
