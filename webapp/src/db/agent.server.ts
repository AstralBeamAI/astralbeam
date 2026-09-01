import { eq } from "drizzle-orm"
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
import { agent } from "@/db/schema/organizations.server"
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
  sandboxProviderId: UuidV7Schema,
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
})

class OrganizationAgentConflictError extends Data.TaggedError(
  "OrganizationAgentConflictError",
)<{ readonly message: string }> {}

class OrganizationAgentProviderError extends Data.TaggedError(
  "OrganizationAgentProviderError",
)<{ readonly message: string }> {}

export function readOrganizationAgentState(organizationId: string) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const value = yield* db.query.organization.findFirst({
      columns: { slug: true },
      where: { id: organizationId },
      with: {
        agents: { orderBy: { name: "asc", id: "asc" } },
        sandboxProviders: {
          columns: { id: true, name: true, providerType: true },
          orderBy: { name: "asc", id: "asc" },
        },
      },
    })
    if (value === undefined) return yield* Effect.die(new Error("Organization not found"))
    const { slug: organizationSlug, ...state } = yield* Schema.decodeUnknownEffect(
      OrganizationAgentStateSchema,
      { onExcessProperty: "error" },
    )(value).pipe(Effect.orDie)
    return { organizationSlug, ...state }
  })
}

export function createOrganizationAgent(input: {
  organizationId: string
  slug: string
  name: string
  systemPrompt: string
  sandboxProviderId: string
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
  sandboxProviderId: string
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
  return Effect.flatMap(effectDatabase, (db) =>
    deleteWithOptimisticLock({
      executor: db,
      table: agent,
      id: input.id,
      scope: eq(agent.organizationId, input.organizationId),
      expectedLockVersion: input.lockVersion,
    }))
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
