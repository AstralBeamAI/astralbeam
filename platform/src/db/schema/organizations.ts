import { sql } from "drizzle-orm"
import { boolean, check, index, integer, uniqueIndex } from "drizzle-orm/pg-core"
import type { AnyPgColumn, ForeignKeyBuilder } from "drizzle-orm/pg-core"
import * as Schema from "effect/Schema"

import {
  isProviderCredentials,
  SandboxProviderCredentialsSchema,
  SandboxProviderIdSchema,
  SandboxProviderOptionsSchema,
  SandboxTestMetadataSchema,
} from "@/lib/sandboxes/schemas.ts"
import {
  ModelProviderCredentialsPayloadSchema,
  ModelConfigurationSchema,
  ModelProviderFieldsSchema,
} from "@/lib/model-providers/schemas.ts"
import { DisplayNameSchema, UuidV7Schema } from "@/lib/schemas.ts"
import { AgentSystemPromptSchema } from "@/lib/agents/schemas.ts"
import { defineModel, primaryKey } from "@/lib/persistence.server"

import {
  caseInsensitiveText,
  deferrableForeignKey,
  encryptedJson,
  jsonb,
  lockVersion,
  timestamps,
  timestampWithTimeZone,
  uuidV7,
  text,
} from "../lib/columns.ts"
import {
  ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS,
  ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS,
} from "@/lib/api-keys/schemas.ts"
import { fileObject } from "./files.ts"
import { user } from "./authentication.ts"

export const OrganizationIdSchema = UuidV7Schema.pipe(Schema.brand("astralbeam/OrganizationId"))
export type OrganizationId = typeof OrganizationIdSchema.Type

export const TenantIdSchema = UuidV7Schema.pipe(Schema.brand("astralbeam/TenantId"))
export type TenantId = typeof TenantIdSchema.Type

export const TenantUserIdSchema = UuidV7Schema.pipe(Schema.brand("astralbeam/TenantUserId"))
export type TenantUserId = typeof TenantUserIdSchema.Type

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

export const organization = defineModel(
  "organization",
  {
    id: uuidV7(),
    name: text().notNull(),
    slug: text().notNull(),
    // Better Auth requires this column. Keep it null and use logoFileId for logos.
    // https://better-auth.com/docs/plugins/organization#schema
    logo: text(),
    logoFileId: uuidV7({ generated: false }),
    domain: text().notNull(),
    metadata: text(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "organization_pkey", columns: [table.id] }),
    uniqueIndex("organization_slug_uidx").on(table.slug),
    deferrableForeignKey({
      name: "organization_logo_current_fk",
      columns: [table.id, table.logoFileId],
      foreignColumns: [fileObject.organizationId, fileObject.id],
    }),
    check("organization_slug_check", sql`${table.slug} ~ '^[0-9a-z-]{1,63}$'`),
  ],
)

export function organizationForeignKey(table: { organizationId: AnyPgColumn }): ForeignKeyBuilder {
  return deferrableForeignKey({
    columns: [table.organizationId],
    foreignColumns: [organization.id],
  }).onDelete("cascade")
}

type TenantReference = { organizationId: AnyPgColumn; tenantId: AnyPgColumn }
type ReferenceOptions = Pick<Parameters<typeof deferrableForeignKey>[0], "name" | "deferrable">

export function tenantForeignKey(
  table: TenantReference,
  options?: ReferenceOptions,
): ForeignKeyBuilder {
  return deferrableForeignKey({
    ...options,
    columns: [table.organizationId, table.tenantId],
    foreignColumns: [tenant.organizationId, tenant.id],
  })
}

export function tenantUserForeignKey(
  table: TenantReference & {
    tenantUserId: AnyPgColumn
  },
  options?: ReferenceOptions,
): ForeignKeyBuilder {
  return deferrableForeignKey({
    ...options,
    columns: [table.organizationId, table.tenantId, table.tenantUserId],
    foreignColumns: [tenantUser.organizationId, tenantUser.tenantId, tenantUser.id],
  })
}

export const apiKey = defineModel(
  "api_key",
  {
    id: uuidV7(),
    configId: text().default("default").notNull(),
    name: text().notNull(),
    start: text(),
    organizationId: uuidV7({ generated: false }).notNull(),
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
    primaryKey({ name: "api_key_pkey", columns: [table.id] }),
    index("api_key_config_id_idx").on(table.configId),
    index("api_key_organization_id_idx").on(table.organizationId),
    uniqueIndex("api_key_key_idx").on(table.key),
    organizationForeignKey(table),
  ],
)

export const sandboxProvider = defineModel(
  "sandbox_provider",
  {
    id: uuidV7(),
    organizationId: uuidV7({ generated: false }).notNull(),
    name: caseInsensitiveText({ schema: DisplayNameSchema }).notNull(),
    providerType: text({ enum: SandboxProviderIdSchema.literals }).notNull(),
    options: jsonb({ schema: SandboxProviderOptionsSchema }).notNull(),
    credentials: encryptedJson({ schema: SandboxProviderCredentialsPayloadSchema }),
    lastTest: jsonb({ schema: SandboxTestMetadataSchema }),
    lockVersion: lockVersion(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({
      name: "sandbox_provider_pkey",
      columns: [table.organizationId, table.id],
    }),
    uniqueIndex("sandbox_provider_organization_id_name_uidx").on(table.organizationId, table.name),
    organizationForeignKey(table),
  ],
)

export const modelProvider = defineModel(
  "model_provider",
  {
    id: uuidV7(),
    organizationId: uuidV7({ generated: false }).notNull(),
    name: caseInsensitiveText({ schema: DisplayNameSchema }).notNull(),
    providerType: text({ enum: ModelProviderFieldsSchema.fields.providerType.literals }).notNull(),
    api: text({ enum: ModelProviderFieldsSchema.fields.api.literals }).notNull(),
    baseUrl: text({ schema: ModelProviderFieldsSchema.fields.baseUrl }).notNull(),
    credentials: encryptedJson({ schema: ModelProviderCredentialsPayloadSchema }),
    lockVersion: lockVersion(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "model_provider_pkey", columns: [table.organizationId, table.id] }),
    uniqueIndex("model_provider_organization_id_name_uidx").on(table.organizationId, table.name),
    organizationForeignKey(table),
  ],
)

export const providerModel = defineModel(
  "provider_model",
  {
    id: uuidV7(),
    organizationId: uuidV7({ generated: false }).notNull(),
    modelProviderId: uuidV7({ generated: false }).notNull(),
    modelId: text().notNull(),
    name: text().notNull(),
    configuration: jsonb({ schema: ModelConfigurationSchema }),
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
    organizationForeignKey(table),
  ],
)

export const agent = defineModel(
  "agent",
  {
    id: uuidV7(),
    organizationId: uuidV7({ generated: false }).notNull(),
    name: caseInsensitiveText({ schema: DisplayNameSchema }).notNull(),
    systemPrompt: text({ schema: AgentSystemPromptSchema }).notNull(),
    // Agent capability policy the chat endpoint enforces; the SDK can narrow it, never grant it.
    attachmentsEnabled: boolean().notNull().default(true),
    webAccessEnabled: boolean().notNull().default(false),
    // Optional so a new organization has a usable agent before anyone configures a provider,
    // which cannot be saved until its connection test passes.
    sandboxProviderId: uuidV7({ generated: false }),
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
    organizationForeignKey(table),
  ],
)

export const agentModel = defineModel(
  "agent_model",
  {
    id: uuidV7(),
    organizationId: uuidV7({ generated: false }).notNull(),
    agentId: uuidV7({ generated: false }).notNull(),
    providerModelId: uuidV7({ generated: false }).notNull(),
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
    organizationForeignKey(table),
  ],
)

export const organizationConfiguration = defineModel(
  "organization_configuration",
  {
    id: uuidV7(),
    organizationId: uuidV7({ generated: false }).notNull(),
    defaultAgentId: uuidV7({ generated: false }),
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
    organizationForeignKey(table),
  ],
)

export const tenant = defineModel(
  "tenant",
  {
    organizationId: uuidV7({ generated: false }).$type<OrganizationId>().notNull(),
    id: uuidV7().$type<TenantId>(),
    externalId: text().notNull(),
    name: text(),
    metadata: jsonb({ schema: Schema.JsonObject }).default({}).notNull(),
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
    organizationForeignKey(table),
  ],
)

export const tenantUser = defineModel(
  "tenant_user",
  {
    organizationId: uuidV7({ generated: false }).$type<OrganizationId>().notNull(),
    tenantId: uuidV7({ generated: false }).$type<TenantId>().notNull(),
    id: uuidV7().$type<TenantUserId>(),
    externalId: text().notNull(),
    name: text(),
    admin: boolean().default(false).notNull(),
    metadata: jsonb({ schema: Schema.JsonObject }).default({}).notNull(),
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
    tenantForeignKey(table, { name: "tenant_user_organization_id_tenant_id_fk" }).onDelete(
      "cascade",
    ),
  ],
)

export const member = defineModel(
  "member",
  {
    id: uuidV7(),
    organizationId: uuidV7({ generated: false }).notNull(),
    userId: uuidV7({ generated: false }).notNull(),
    avatarFileId: uuidV7({ generated: false }),
    role: text().default("viewer").notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "member_pkey", columns: [table.id] }),
    deferrableForeignKey({
      name: "member_avatar_current_fk",
      columns: [table.organizationId, table.avatarFileId],
      foreignColumns: [fileObject.organizationId, fileObject.id],
    }),
    uniqueIndex("member_organization_user_uidx").on(table.organizationId, table.userId),
    index("member_user_id_idx").on(table.userId),
    organizationForeignKey(table),
    deferrableForeignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
    }).onDelete("cascade"),
  ],
)

export const invitation = defineModel(
  "invitation",
  {
    id: uuidV7(),
    organizationId: uuidV7({ generated: false }).notNull(),
    email: caseInsensitiveText().notNull(),
    role: text(),
    status: text().default("pending").notNull(),
    expiresAt: timestampWithTimeZone().notNull(),
    inviterId: uuidV7({ generated: false }).notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "invitation_pkey", columns: [table.id] }),
    index("invitation_organization_id_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
    organizationForeignKey(table),
    deferrableForeignKey({
      columns: [table.inviterId],
      foreignColumns: [user.id],
    }).onDelete("cascade"),
  ],
)
