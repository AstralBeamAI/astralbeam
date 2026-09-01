import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
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
  type SandboxProviderOptions,
  type SandboxTestMetadata,
} from "../../lib/sandbox/schemas.ts"
import { UuidV7Schema } from "../../lib/schemas.ts"

import {
  caseInsensitiveText,
  encryptedJson,
  lockVersion,
  timestamps,
  timestampWithTimeZone,
  uuidV7PrimaryKey,
} from "../lib/columns.server.ts"
import {
  ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS,
  ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS,
} from "../../lib/auth/organization-api-key-configuration.ts"
import { user } from "./authentication.server.ts"

export const SandboxProviderCredentialsPayloadSchema = Schema.Struct({
  sandboxProviderId: UuidV7Schema,
  organizationId: UuidV7Schema,
  providerType: SandboxProviderIdSchema,
  credentials: SandboxProviderCredentialsSchema,
}).pipe(
  Schema.check(
    Schema.makeFilter((payload) =>
      isProviderCredentials(payload.providerType, payload.credentials)
    ),
  ),
)

const decodeSandboxProviderCredentialsPayload = Schema.decodeUnknownSync(
  SandboxProviderCredentialsPayloadSchema,
  { onExcessProperty: "error" },
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
    check("organization_slug_check", sql`${table.slug} ~ '^[0-9a-z]{1,63}$'`),
  ],
)

export const apiKey = snakeCase.table(
  "api_key",
  {
    id: uuidV7PrimaryKey(),
    configId: text().default("default").notNull(),
    name: text().notNull(),
    slug: text().notNull(),
    start: text(),
    organizationId: uuid().notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
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
    uniqueIndex("api_key_organization_id_slug_uidx").on(
      table.organizationId,
      table.slug,
    ),
    check("api_key_slug_check", sql`${table.slug} ~ '^[0-9a-z]{1,63}$'`),
  ],
)

export const sandboxProvider = snakeCase.table(
  "sandbox_provider",
  {
    id: uuidV7PrimaryKey(),
    organizationId: uuid().notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    name: caseInsensitiveText().notNull(),
    providerType: text().$type<SandboxProviderId>().notNull(),
    options: jsonb().$type<SandboxProviderOptions[SandboxProviderId]>().notNull(),
    credentials: encryptedJson({ decode: decodeSandboxProviderCredentialsPayload }),
    lastTest: jsonb().$type<SandboxTestMetadata>(),
    lockVersion: lockVersion(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("sandbox_provider_organization_id_id_uidx").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("sandbox_provider_organization_id_name_uidx").on(
      table.organizationId,
      table.name,
    ),
  ],
)

export const agent = snakeCase.table(
  "agent",
  {
    id: uuidV7PrimaryKey(),
    organizationId: uuid().notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    slug: text().notNull(),
    name: text().notNull(),
    systemPrompt: text().notNull(),
    // Agent capability policy the chat endpoint enforces; the SDK can narrow it, never grant it.
    attachmentsEnabled: boolean().notNull().default(true),
    // Optional so a new organization has a usable agent before anyone configures a provider,
    // which cannot be saved until its connection test passes.
    sandboxProviderId: uuid(),
    lockVersion: lockVersion(),
    ...timestamps(),
  },
  (table) => [
    index("agent_organization_id_sandbox_provider_id_idx").on(
      table.organizationId,
      table.sandboxProviderId,
    ),
    uniqueIndex("agent_organization_id_id_uidx").on(table.organizationId, table.id),
    uniqueIndex("agent_organization_id_slug_uidx").on(table.organizationId, table.slug),
    check("agent_slug_check", sql`${table.slug} ~ '^[0-9a-z]{1,63}$'`),
    check(
      "agent_system_prompt_length_check",
      sql`char_length(${table.systemPrompt}) between 1 and 32768`,
    ),
    foreignKey({
      name: "agent_organization_id_sandbox_provider_id_fk",
      columns: [table.organizationId, table.sandboxProviderId],
      foreignColumns: [sandboxProvider.organizationId, sandboxProvider.id],
    }).onDelete("restrict"),
  ],
)

export const organizationConfiguration = snakeCase.table(
  "organization_configuration",
  {
    id: uuidV7PrimaryKey(),
    organizationId: uuid().notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    defaultAgentId: uuid(),
    lockVersion: lockVersion(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("organization_configuration_organization_id_uidx").on(table.organizationId),
    // The composite reference keeps the default agent inside its own organization. MATCH SIMPLE
    // leaves the row unchecked while the default is null, and the restricted delete makes an
    // agent removal clear the default first. https://www.postgresql.org/docs/18/ddl-constraints.html#DDL-CONSTRAINTS-FK
    foreignKey({
      name: "organization_configuration_default_agent_id_fk",
      columns: [table.organizationId, table.defaultAgentId],
      foreignColumns: [agent.organizationId, agent.id],
    }).onDelete("restrict"),
  ],
)

export const member = snakeCase.table(
  "member",
  {
    id: uuidV7PrimaryKey(),
    organizationId: uuid().notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    userId: uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
    role: text().default("viewer").notNull(),
    ...timestamps(),
  },
  (table) => [
    // Keep Better Auth's generated member shape: organization and user are referenced independently, while its official APIs enforce membership creation. https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/organization/schema.ts#L140-L166
    index("member_organization_id_idx").on(table.organizationId),
    index("member_user_id_idx").on(table.userId),
  ],
)

export const invitation = snakeCase.table(
  "invitation",
  {
    id: uuidV7PrimaryKey(),
    organizationId: uuid().notNull().references(() => organization.id, {
      onDelete: "cascade",
    }),
    email: caseInsensitiveText().notNull(),
    role: text(),
    status: text().default("pending").notNull(),
    expiresAt: timestampWithTimeZone().notNull(),
    inviterId: uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (table) => [
    index("invitation_organization_id_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
)
