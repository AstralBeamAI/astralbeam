import { index, primaryKey, snakeCase, text, unique, uuid } from "drizzle-orm/pg-core"
import {
  deferrableForeignKey,
  encryptedJson,
  lockVersion,
  schemaJsonb,
  timestamps,
  uuidV7,
} from "../lib/columns.ts"
import { organization, tenantUser } from "./organizations.ts"
import { McpCredentialEnvelopeSchema, McpStoredAuthConfigSchema } from "../../lib/mcp/schemas.ts"

export const mcpServer = snakeCase.table(
  "mcp_server",
  {
    organizationId: uuid().notNull(),
    id: uuidV7(),
    endpointUrl: text().notNull(),
    authConfig: schemaJsonb(McpStoredAuthConfigSchema).notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.id] }),
    unique("mcp_server_endpoint_uidx").on(t.organizationId, t.endpointUrl),
    deferrableForeignKey({
      columns: [t.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
  ],
)
export const mcpConnection = snakeCase.table(
  "mcp_connection",
  {
    organizationId: uuid().notNull(),
    tenantId: uuid().notNull(),
    id: uuidV7(),
    tenantUserId: uuid().notNull(),
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
    deferrableForeignKey({
      columns: [t.organizationId, t.tenantId, t.tenantUserId],
      foreignColumns: [tenantUser.organizationId, tenantUser.tenantId, tenantUser.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      columns: [t.organizationId, t.mcpServerId],
      foreignColumns: [mcpServer.organizationId, mcpServer.id],
    }).onDelete("cascade"),
  ],
)
