import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  primaryKey,
  snakeCase,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"

import {
  isProviderCredentials,
  SandboxProviderCredentialsSchema,
  type SandboxProviderId,
  SandboxProviderIdSchema,
  SandboxProviderOptionsSchema,
  SandboxTestMetadataSchema,
} from "../../lib/sandboxes/schemas.ts"
import {
  ModelProviderCredentialsPayloadSchema,
  type ModelProviderType,
  type ModelProviderApi,
} from "../../lib/model-providers/schemas.ts"
import { UuidV7Schema } from "../../lib/schemas.ts"

import {
  caseInsensitiveText,
  deferrableForeignKey,
  encryptedJson,
  schemaJsonb,
  lockVersion,
  timestamps,
  timestampWithTimeZone,
  uuidV7,
  uuidV7PrimaryKey,
} from "../lib/columns.server.ts"
import {
  ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS,
  ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS,
} from "../../lib/api-keys/schemas.ts"
import { user } from "./authentication.server.ts"

export const SandboxProviderCredentialsPayloadSchema = Schema.Struct({
  sandboxProviderId: UuidV7Schema,
  organizationId: UuidV7Schema,
  providerType: SandboxProviderIdSchema,
  credentials: SandboxProviderCredentialsSchema,
}).pipe(
  Schema.check(
    Schema.makeFilter((payload) =>
      isProviderCredentials(payload.providerType, payload.credentials),
    ),
  ),
)

export const organization = snakeCase.table(
  "organization",
  {
    id: uuidV7PrimaryKey(),
    name: text().notNull(),
    slug: text().notNull(),
    logo: text(),
    metadata: text(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("organization_slug_uidx").on(table.slug),
    check("organization_slug_check", sql`${table.slug} ~ '^[0-9a-z-]{1,63}$'`),
  ],
)

export const apiKey = snakeCase.table(
  "api_key",
  {
    id: uuidV7PrimaryKey(),
    configId: text().default("default").notNull(),
    name: text().notNull(),
    start: text(),
    organizationId: uuid().notNull(),
    prefix: text(),
    // Better Auth stores a SHA-256 digest, not the bearer key. https://better-auth.com/docs/plugins/api-key/reference#schema
    key: text().notNull(),
    // Better Auth includes these nullable quota fields in every API-key insert. https://better-auth.com/docs/plugins/api-key/advanced#remaining-refill-and-expiration
    refillInterval: integer(),
    refillAmount: integer(),
    lastRefillAt: timestampWithTimeZone(),
    enabled: boolean().default(true).notNull(),
    rateLimitEnabled: boolean().default(true).notNull(),
    rateLimitTimeWindow: integer().default(ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS).notNull(),
    rateLimitMax: integer().default(ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS).notNull(),
    requestCount: integer().default(0).notNull(),
    remaining: integer(),
    lastRequest: timestampWithTimeZone(),
    expiresAt: timestampWithTimeZone(),
    permissions: text(),
    metadata: text(),
    ...timestamps(),
  },
  (table) => [
    index("api_key_config_id_idx").on(table.configId),
    index("api_key_organization_id_idx").on(table.organizationId),
    uniqueIndex("api_key_key_idx").on(table.key),
    deferrableForeignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
  ],
)

export const sandboxProvider = snakeCase.table(
  "sandbox_provider",
  {
    id: uuidV7(),
    organizationId: uuid().notNull(),
    name: caseInsensitiveText().notNull(),
    providerType: text().$type<SandboxProviderId>().notNull(),
    options: schemaJsonb(SandboxProviderOptionsSchema).notNull(),
    credentials: encryptedJson({ schema: SandboxProviderCredentialsPayloadSchema }),
    lastTest: schemaJsonb(SandboxTestMetadataSchema),
    lockVersion: lockVersion(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({
      name: "sandbox_provider_pkey",
      columns: [table.organizationId, table.id],
    }),
    uniqueIndex("sandbox_provider_organization_id_name_uidx").on(table.organizationId, table.name),
    deferrableForeignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
  ],
)

export const modelProvider = snakeCase.table(
  "model_provider",
  {
    id: uuidV7(),
    organizationId: uuid().notNull(),
    name: caseInsensitiveText().notNull(),
    providerType: text().$type<ModelProviderType>().notNull(),
    api: text().$type<ModelProviderApi>().notNull(),
    baseUrl: text().notNull(),
    credentials: encryptedJson({ schema: ModelProviderCredentialsPayloadSchema }),
    lockVersion: lockVersion(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "model_provider_pkey", columns: [table.organizationId, table.id] }),
    uniqueIndex("model_provider_organization_id_name_uidx").on(table.organizationId, table.name),
    deferrableForeignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
  ],
)

export const providerModel = snakeCase.table(
  "provider_model",
  {
    id: uuidV7(),
    organizationId: uuid().notNull(),
    modelProviderId: uuid().notNull(),
    modelId: text().notNull(),
    name: text().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "provider_model_pkey", columns: [table.organizationId, table.id] }),
    uniqueIndex("provider_model_provider_model_uidx").on(
      table.organizationId,
      table.modelProviderId,
      table.modelId,
    ),
    deferrableForeignKey({
      name: "provider_model_provider_fk",
      columns: [table.organizationId, table.modelProviderId],
      foreignColumns: [modelProvider.organizationId, modelProvider.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
  ],
)

export const agent = snakeCase.table(
  "agent",
  {
    id: uuidV7(),
    organizationId: uuid().notNull(),
    name: caseInsensitiveText().notNull(),
    systemPrompt: text().notNull(),
    // Agent capability policy the chat endpoint enforces; the SDK can narrow it, never grant it.
    attachmentsEnabled: boolean().notNull().default(true),
    webAccessEnabled: boolean().notNull().default(false),
    // Optional so a new organization has a usable agent before anyone configures a provider,
    // which cannot be saved until its connection test passes.
    sandboxProviderId: uuid(),
    lockVersion: lockVersion(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "agent_pkey", columns: [table.organizationId, table.id] }),
    index("agent_organization_id_sandbox_provider_id_idx").on(
      table.organizationId,
      table.sandboxProviderId,
    ),
    // The name is the only human-readable handle left once the ID is opaque.
    uniqueIndex("agent_organization_id_name_uidx").on(table.organizationId, table.name),
    check(
      "agent_system_prompt_length_check",
      sql`char_length(${table.systemPrompt}) between 1 and 32768`,
    ),
    deferrableForeignKey({
      name: "agent_organization_id_sandbox_provider_id_fk",
      columns: [table.organizationId, table.sandboxProviderId],
      foreignColumns: [sandboxProvider.organizationId, sandboxProvider.id],
    }).onDelete("no action"),
    deferrableForeignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
  ],
)

export const agentModel = snakeCase.table(
  "agent_model",
  {
    id: uuidV7(),
    organizationId: uuid().notNull(),
    agentId: uuid().notNull(),
    providerModelId: uuid().notNull(),
    position: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "agent_model_pkey", columns: [table.organizationId, table.id] }),
    uniqueIndex("agent_model_assignment_uidx").on(
      table.organizationId,
      table.agentId,
      table.providerModelId,
    ),
    uniqueIndex("agent_model_position_uidx").on(
      table.organizationId,
      table.agentId,
      table.position,
    ),
    // Serves the foreign key check when a provider model is deleted.
    index("agent_model_organization_id_provider_model_id_idx").on(
      table.organizationId,
      table.providerModelId,
    ),
    check("agent_model_position_check", sql`${table.position} >= 0`),
    deferrableForeignKey({
      name: "agent_model_agent_fk",
      columns: [table.organizationId, table.agentId],
      foreignColumns: [agent.organizationId, agent.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      name: "agent_model_provider_model_fk",
      columns: [table.organizationId, table.providerModelId],
      foreignColumns: [providerModel.organizationId, providerModel.id],
    }).onDelete("no action"),
    deferrableForeignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
  ],
)

export const organizationConfiguration = snakeCase.table(
  "organization_configuration",
  {
    id: uuidV7(),
    organizationId: uuid().notNull(),
    defaultAgentId: uuid(),
    lockVersion: lockVersion(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({
      name: "organization_configuration_pkey",
      columns: [table.organizationId, table.id],
    }),
    uniqueIndex("organization_configuration_organization_id_uidx").on(table.organizationId),
    // Migration SQL limits SET NULL to default_agent_id, preserving organization_id.
    // https://www.postgresql.org/docs/18/sql-createtable.html
    deferrableForeignKey({
      name: "organization_configuration_default_agent_id_fk",
      columns: [table.organizationId, table.defaultAgentId],
      foreignColumns: [agent.organizationId, agent.id],
    }).onDelete("set null"),
    deferrableForeignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
  ],
)

export const tenant = snakeCase.table(
  "tenant",
  {
    organizationId: uuid().notNull(),
    id: uuidV7(),
    externalId: text().notNull(),
    name: text(),
    metadata: schemaJsonb(Schema.JsonObject).default({}).notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "tenant_pkey", columns: [table.organizationId, table.id] }),
    uniqueIndex("tenant_organization_id_external_id_uidx").on(
      table.organizationId,
      table.externalId,
    ),
    check("tenant_metadata_object_check", sql`jsonb_typeof(${table.metadata}) = 'object'`),
    index("tenant_name_trgm_idx").using("gin", table.name.op("gin_trgm_ops")),
    index("tenant_external_id_trgm_idx").using("gin", table.externalId.op("gin_trgm_ops")),
    deferrableForeignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
  ],
)

export const tenantUser = snakeCase.table(
  "tenant_user",
  {
    organizationId: uuid().notNull(),
    tenantId: uuid().notNull(),
    id: uuidV7(),
    externalId: text().notNull(),
    name: text(),
    admin: boolean().default(false).notNull(),
    metadata: schemaJsonb(Schema.JsonObject).default({}).notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({
      name: "tenant_user_pkey",
      columns: [table.organizationId, table.tenantId, table.id],
    }),
    uniqueIndex("tenant_user_organization_id_tenant_id_external_id_uidx").on(
      table.organizationId,
      table.tenantId,
      table.externalId,
    ),
    check("tenant_user_metadata_object_check", sql`jsonb_typeof(${table.metadata}) = 'object'`),
    index("tenant_user_name_trgm_idx").using("gin", table.name.op("gin_trgm_ops")),
    index("tenant_user_external_id_trgm_idx").using("gin", table.externalId.op("gin_trgm_ops")),
    deferrableForeignKey({
      name: "tenant_user_organization_id_tenant_id_fk",
      columns: [table.organizationId, table.tenantId],
      foreignColumns: [tenant.organizationId, tenant.id],
    }).onDelete("cascade"),
  ],
)

export const member = snakeCase.table(
  "member",
  {
    id: uuidV7PrimaryKey(),
    organizationId: uuid().notNull(),
    userId: uuid().notNull(),
    role: text().default("viewer").notNull(),
    ...timestamps(),
  },
  (table) => [
    // Keep Better Auth's generated member shape: organization and user are referenced independently, while its official APIs enforce membership creation. https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/organization/schema.ts#L140-L166
    index("member_organization_id_idx").on(table.organizationId),
    index("member_user_id_idx").on(table.userId),
    deferrableForeignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
    }).onDelete("cascade"),
  ],
)

export const invitation = snakeCase.table(
  "invitation",
  {
    id: uuidV7PrimaryKey(),
    organizationId: uuid().notNull(),
    email: caseInsensitiveText().notNull(),
    role: text(),
    status: text().default("pending").notNull(),
    expiresAt: timestampWithTimeZone().notNull(),
    inviterId: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    index("invitation_organization_id_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
    deferrableForeignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      columns: [table.inviterId],
      foreignColumns: [user.id],
    }).onDelete("cascade"),
  ],
)
