import { and, eq, sql } from "drizzle-orm"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { effectDatabase } from "@/db"
import {
  deleteWithOptimisticLock,
  updateWithOptimisticLock,
} from "@/db/lib/optimistic-locking.server"
import { sqlConstraint } from "@/db/lib/sqlstate.server"
import { agent, organizationConfiguration } from "@/db/schema/organizations.server"
import {
  AgentNameSchema,
  AgentSystemPromptSchema,
  LockVersionSchema,
  SlugSchema,
  UuidV7Schema,
} from "@/lib/schemas"
import { SandboxProviderIdSchema, SandboxProviderNameSchema } from "@/lib/sandbox/schemas"

const OrganizationAgentSchema = createSelectSchema(agent, {
  id: UuidV7Schema,
  organizationId: UuidV7Schema,
  slug: SlugSchema,
  name: AgentNameSchema,
  systemPrompt: AgentSystemPromptSchema,
  sandboxProviderId: Schema.NullOr(UuidV7Schema),
  lockVersion: LockVersionSchema,
})
export type OrganizationAgent = typeof OrganizationAgentSchema.Type

const AgentSandboxProviderSummarySchema = Schema.Struct({
  id: UuidV7Schema,
  name: SandboxProviderNameSchema,
  providerType: SandboxProviderIdSchema,
})

const OrganizationAgentStateSchema = Schema.Struct({
  slug: SlugSchema,
  agents: Schema.Array(OrganizationAgentSchema),
  sandboxProviders: Schema.Array(AgentSandboxProviderSummarySchema),
  configuration: Schema.NullOr(Schema.Struct({ defaultAgentId: Schema.NullOr(UuidV7Schema) })),
})

class OrganizationAgentConflictError extends Data.TaggedError(
  "OrganizationAgentConflictError",
)<{ readonly message: string }> {}

class OrganizationAgentProviderError extends Data.TaggedError(
  "OrganizationAgentProviderError",
)<{ readonly message: string }> {}

class OrganizationDefaultAgentError extends Data.TaggedError(
  "OrganizationDefaultAgentError",
)<{ readonly message: string }> {}

/** Slug of the agent every new organization starts with, so its public ID is predictable. */
const DEFAULT_AGENT_SLUG = "assistant"

const DEFAULT_AGENT_NAME_SUFFIX = " Assistant"
const AGENT_NAME_MAX_LENGTH = 100

/** Names the starter agent after its organization, within the limit the agent form enforces. */
export function defaultAgentName(organizationName: string): string {
  const trimmed = organizationName.trim()
  const name = `${trimmed}${DEFAULT_AGENT_NAME_SUFFIX}`
  if (name.length <= AGENT_NAME_MAX_LENGTH) return name
  const room = AGENT_NAME_MAX_LENGTH - DEFAULT_AGENT_NAME_SUFFIX.length
  return `${trimmed.slice(0, room).trimEnd()}${DEFAULT_AGENT_NAME_SUFFIX}`
}

/** Starter persona; the chat endpoint always prepends its own product-neutral system prompt. */
function defaultAgentSystemPrompt(organizationName: string): string {
  return `You are the assistant for ${organizationName.trim()}. Help its users with their ` +
    "questions and tasks inside the application you are embedded in, acting through the tools " +
    "and widgets that application declares. Ask one short clarifying question when a request " +
    "is ambiguous, and say plainly when something is outside what you can do."
}

export function readOrganizationAgentState(organizationId: string) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const value = yield* db.query.organization.findFirst({
      columns: { slug: true },
      where: { id: organizationId },
      with: {
        agents: { orderBy: { name: "asc", id: "asc" } },
        configuration: { columns: { defaultAgentId: true } },
        sandboxProviders: {
          columns: { id: true, name: true, providerType: true },
          orderBy: { name: "asc", id: "asc" },
        },
      },
    })
    if (value === undefined) return yield* Effect.die(new Error("Organization not found"))
    const { slug: organizationSlug, configuration, ...state } = yield* Schema.decodeUnknownEffect(
      OrganizationAgentStateSchema,
      { onExcessProperty: "error" },
    )(value).pipe(Effect.orDie)
    return { organizationSlug, defaultAgentId: configuration?.defaultAgentId ?? null, ...state }
  })
}

/**
 * Gives a new organization the agent and default-agent configuration an SDK mount needs, so a
 * host page can omit its agent ID from the first minute.
 */
export function provisionOrganizationDefaultAgent(input: {
  organizationId: string
  organizationName: string
}) {
  return Effect.flatMap(
    effectDatabase,
    (db) =>
      db.transaction((transaction) =>
        Effect.gen(function* () {
          const rows = yield* transaction.insert(agent).values({
            organizationId: input.organizationId,
            slug: DEFAULT_AGENT_SLUG,
            name: defaultAgentName(input.organizationName),
            systemPrompt: defaultAgentSystemPrompt(input.organizationName),
          }).returning({ id: agent.id })
          const created = rows[0]
          if (!created) {
            return yield* Effect.fail(new Error("PostgreSQL did not return the created agent"))
          }
          yield* transaction.insert(organizationConfiguration).values({
            organizationId: input.organizationId,
            defaultAgentId: created.id,
          })
          return created.id
        })
      ),
  )
}

/** Points the organization's configuration at `id`, creating the configuration row on demand. */
export function setOrganizationDefaultAgent(input: { organizationId: string; id: string }) {
  return Effect.flatMap(effectDatabase, (db) =>
    db.insert(organizationConfiguration).values({
      organizationId: input.organizationId,
      defaultAgentId: input.id,
    }).onConflictDoUpdate({
      target: organizationConfiguration.organizationId,
      set: {
        defaultAgentId: input.id,
        lockVersion: sql`${organizationConfiguration.lockVersion} + 1`,
        // Drizzle's `updatedAt` hook runs for update statements, not for a conflict clause.
        updatedAt: sql`now()`,
      },
    })).pipe(
      Effect.catchIf(
        isOrganizationDefaultAgentConflict,
        () =>
          Effect.fail(
            new OrganizationDefaultAgentError({
              message: "Select an agent from this organization",
            }),
          ),
      ),
    )
}

export function createOrganizationAgent(input: {
  organizationId: string
  slug: string
  name: string
  systemPrompt: string
  sandboxProviderId: string | null
}) {
  return Effect.flatMap(effectDatabase, (db) => db.insert(agent).values(input)).pipe(
    Effect.catchIf(
      isOrganizationAgentSlugConflict,
      () =>
        Effect.fail(
          new OrganizationAgentConflictError({
            message: "An agent with this identifier already exists",
          }),
        ),
    ),
    Effect.catchIf(
      isOrganizationAgentProviderConflict,
      () => Effect.fail(invalidOrganizationAgentProvider()),
    ),
  )
}

export function updateOrganizationAgent(input: {
  organizationId: string
  id: string
  lockVersion: number
  name: string
  systemPrompt: string
  sandboxProviderId: string | null
}) {
  return Effect.flatMap(effectDatabase, (db) =>
    updateWithOptimisticLock({
      executor: db,
      table: agent,
      id: input.id,
      scope: eq(agent.organizationId, input.organizationId),
      expectedLockVersion: input.lockVersion,
      set: {
        name: input.name,
        systemPrompt: input.systemPrompt,
        sandboxProviderId: input.sandboxProviderId,
      },
    })).pipe(
      Effect.catchIf(
        isOrganizationAgentProviderConflict,
        () => Effect.fail(invalidOrganizationAgentProvider()),
      ),
    )
}

export function deleteOrganizationAgent(input: {
  organizationId: string
  id: string
  lockVersion: number
}) {
  return Effect.flatMap(
    effectDatabase,
    (db) =>
      db.transaction((transaction) =>
        Effect.gen(function* () {
          // The configuration's restricted reference blocks the delete while this agent is the
          // organization's default, so release it in the same transaction.
          yield* transaction.update(organizationConfiguration).set({
            defaultAgentId: null,
            lockVersion: sql`${organizationConfiguration.lockVersion} + 1`,
          }).where(
            and(
              eq(organizationConfiguration.organizationId, input.organizationId),
              eq(organizationConfiguration.defaultAgentId, input.id),
            ),
          )
          return yield* deleteWithOptimisticLock({
            executor: transaction,
            table: agent,
            id: input.id,
            scope: eq(agent.organizationId, input.organizationId),
            expectedLockVersion: input.lockVersion,
          })
        })
      ),
  )
}

function invalidOrganizationAgentProvider() {
  return new OrganizationAgentProviderError({
    message: "Select a sandbox provider from this organization",
  })
}

function isOrganizationAgentSlugConflict(error: unknown): boolean {
  return sqlConstraint(error) === "agent_organization_id_slug_uidx"
}

function isOrganizationAgentProviderConflict(error: unknown): boolean {
  return sqlConstraint(error) === "agent_organization_id_sandbox_provider_id_fk"
}

function isOrganizationDefaultAgentConflict(error: unknown): boolean {
  return sqlConstraint(error) === "organization_configuration_default_agent_id_fk"
}
