import { and, eq, sql } from "drizzle-orm"
import { createSelectSchema } from "drizzle-orm/effect-schema"
import { Context, Effect, Layer, Schema } from "effect"

import { Database } from "@/db/database.server"
import {
  deleteWithOptimisticLock,
  updateWithOptimisticLock,
} from "@/db/lib/optimistic-locking.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import { agent, organizationConfiguration } from "@/db/schema/organizations.server"
import { SandboxProviderIdSchema, SandboxProviderNameSchema } from "@/lib/sandboxes/schemas"
import { LockVersionSchema, UuidV7Schema } from "@/lib/schemas"
import {
  AgentChanged,
  AgentNameTaken,
  AgentNotFound,
  AgentSandboxProviderInvalid,
} from "./errors.ts"
import {
  type AgentFields,
  AgentNameSchema,
  AgentSystemPromptSchema,
  formatAgentId,
  parseAgentId,
} from "./schemas.ts"

const AgentRowSchema = createSelectSchema(agent, {
  id: UuidV7Schema,
  organizationId: UuidV7Schema,
  name: AgentNameSchema,
  systemPrompt: AgentSystemPromptSchema,
  sandboxProviderId: Schema.NullOr(UuidV7Schema),
  lockVersion: LockVersionSchema,
})

/** An agent as the dashboard sees it, addressed by its public ID. */
export type Agent = typeof AgentRowSchema.Type

const AgentSandboxProviderSchema = Schema.Struct({
  id: UuidV7Schema,
  name: SandboxProviderNameSchema,
  providerType: SandboxProviderIdSchema,
})

export type AgentSandboxProvider = typeof AgentSandboxProviderSchema.Type

const DefaultAgentConfigurationSchema = Schema.NullOr(
  Schema.Struct({ defaultAgentId: Schema.NullOr(UuidV7Schema) }),
)

const decodeAgentList = Schema.decodeUnknownEffect(
  Schema.Struct({
    agents: Schema.Array(AgentRowSchema),
    configuration: DefaultAgentConfigurationSchema,
  }),
  { onExcessProperty: "error" },
)

const decodeAgentFormOptions = Schema.decodeUnknownEffect(
  Schema.Struct({
    sandboxProviders: Schema.Array(AgentSandboxProviderSchema),
    configuration: DefaultAgentConfigurationSchema,
  }),
  { onExcessProperty: "error" },
)

const decodeAgentRow = Schema.decodeUnknownEffect(AgentRowSchema, { onExcessProperty: "error" })

const mapAgentWriteErrors = mapDatabaseErrors({
  agent_organization_id_name_uidx: () => new AgentNameTaken(),
  agent_organization_id_sandbox_provider_id_fk: () => new AgentSandboxProviderInvalid(),
})

const DEFAULT_AGENT_NAME_SUFFIX = " Assistant"
const DEFAULT_AGENT_NAME_MAX_LENGTH = 100

/** Names the starter agent after its organization, within the limit the agent form enforces. */
export function defaultAgentName(organizationName: string): string {
  const trimmed = organizationName.trim()
  const room = DEFAULT_AGENT_NAME_MAX_LENGTH - DEFAULT_AGENT_NAME_SUFFIX.length
  return `${trimmed.length > room ? trimmed.slice(0, room).trimEnd() : trimmed}${DEFAULT_AGENT_NAME_SUFFIX}`
}

/** Starter persona; the chat endpoint always prepends its own product-neutral system prompt. */
function defaultAgentSystemPrompt(organizationName: string): string {
  return (
    `You are the assistant for ${organizationName.trim()}. Help its users with their ` +
    "questions and tasks inside the application you are embedded in, acting through the tools " +
    "and widgets that application declares. Ask one short clarifying question when a request " +
    "is ambiguous, and say plainly when something is outside what you can do."
  )
}

function publicAgent(row: Agent): Agent {
  return { ...row, id: formatAgentId(row) }
}

function publicDefaultAgentId(
  organizationId: string,
  configuration: typeof DefaultAgentConfigurationSchema.Type,
): string | null {
  const id = configuration?.defaultAgentId
  return id ? formatAgentId({ organizationId, id }) : null
}

/** Resolves a public agent ID to its row ID, failing alike for malformed and foreign IDs. */
const ownAgentId = Effect.fnUntraced(function* (organizationId: string, agentId: string) {
  const parsed = parseAgentId(agentId)
  if (parsed?.organizationId !== organizationId) return yield* new AgentNotFound()
  return parsed.id
})

export class Agents extends Context.Service<
  Agents,
  {
    readonly list: (organizationId: string) => Effect.Effect<{
      readonly agents: readonly Agent[]
      readonly defaultAgentId: string | null
    }>
    /** The sandbox providers an agent form can select, and the current default agent. */
    readonly formOptions: (organizationId: string) => Effect.Effect<{
      readonly sandboxProviders: readonly AgentSandboxProvider[]
      readonly defaultAgentId: string | null
    }>
    readonly get: (input: {
      readonly organizationId: string
      readonly agentId: string
    }) => Effect.Effect<Agent, AgentNotFound>
    /** Returns the new agent's public ID. */
    readonly create: (input: {
      readonly organizationId: string
      readonly fields: AgentFields
    }) => Effect.Effect<string, AgentNameTaken | AgentSandboxProviderInvalid>
    readonly update: (input: {
      readonly organizationId: string
      readonly agentId: string
      readonly lockVersion: number
      readonly fields: AgentFields
    }) => Effect.Effect<void, AgentChanged | AgentNameTaken | AgentSandboxProviderInvalid>
    readonly remove: (input: {
      readonly organizationId: string
      readonly agentId: string
      readonly lockVersion: number
    }) => Effect.Effect<void, AgentChanged>
    readonly setDefault: (input: {
      readonly organizationId: string
      readonly agentId: string
    }) => Effect.Effect<void, AgentNotFound>
    /** Recovers a missing default agent without replacing one or creating duplicates. */
    readonly provisionDefault: (input: {
      readonly organizationId: string
      readonly organizationName: string
      readonly openaiApiKey?: string | undefined
    }) => Effect.Effect<string>
  }
>()("astralbeam/agents/Agents") {
  static readonly layerNoDeps = Layer.effect(
    Agents,
    Effect.gen(function* () {
      const db = yield* Database

      const list = Effect.fn("Agents.list")(function* (organizationId: string) {
        const organization = yield* db.query.organization.findFirst({
          columns: {},
          where: { id: organizationId },
          with: {
            agents: { orderBy: { name: "asc", id: "asc" } },
            configuration: { columns: { defaultAgentId: true } },
          },
        })
        const { agents, configuration } = yield* decodeAgentList(organization)
        return {
          agents: agents.map(publicAgent),
          defaultAgentId: publicDefaultAgentId(organizationId, configuration),
        }
      }, Effect.orDie)

      const formOptions = Effect.fn("Agents.formOptions")(function* (organizationId: string) {
        const organization = yield* db.query.organization.findFirst({
          columns: {},
          where: { id: organizationId },
          with: {
            configuration: { columns: { defaultAgentId: true } },
            sandboxProviders: {
              columns: { id: true, name: true, providerType: true },
              orderBy: { name: "asc", id: "asc" },
            },
          },
        })
        const { sandboxProviders, configuration } = yield* decodeAgentFormOptions(organization)
        return {
          sandboxProviders,
          defaultAgentId: publicDefaultAgentId(organizationId, configuration),
        }
      }, Effect.orDie)

      const get = Effect.fn("Agents.get")(function* (input: {
        organizationId: string
        agentId: string
      }) {
        const id = yield* ownAgentId(input.organizationId, input.agentId)
        const [row] = yield* db
          .select()
          .from(agent)
          .where(and(eq(agent.organizationId, input.organizationId), eq(agent.id, id)))
          .limit(1)
          .pipe(Effect.orDie)
        if (!row) return yield* new AgentNotFound()
        return publicAgent(yield* decodeAgentRow(row).pipe(Effect.orDie))
      })

      const create = Effect.fn("Agents.create")(function* (input: {
        organizationId: string
        fields: AgentFields
      }) {
        const [created] = yield* db
          .insert(agent)
          .values({ organizationId: input.organizationId, ...input.fields })
          .returning({ id: agent.id })
          .pipe(mapAgentWriteErrors)
        return formatAgentId({ organizationId: input.organizationId, id: created!.id })
      })

      const update = Effect.fn("Agents.update")(
        function* (input: {
          organizationId: string
          agentId: string
          lockVersion: number
          fields: AgentFields
        }) {
          const id = yield* ownAgentId(input.organizationId, input.agentId)
          yield* updateWithOptimisticLock({
            executor: db,
            table: agent,
            id,
            scope: eq(agent.organizationId, input.organizationId),
            expectedLockVersion: input.lockVersion,
            set: input.fields,
          }).pipe(mapAgentWriteErrors)
        },
        Effect.catchTags({
          AgentNotFound: () => Effect.fail(new AgentChanged()),
          OptimisticLockError: () => Effect.fail(new AgentChanged()),
        }),
      )

      const remove = Effect.fn("Agents.remove")(
        function* (input: { organizationId: string; agentId: string; lockVersion: number }) {
          const id = yield* ownAgentId(input.organizationId, input.agentId)
          yield* db.transaction((transaction) =>
            Effect.gen(function* () {
              // The default agent reference restricts the delete, so release it in the same
              // transaction.
              yield* transaction
                .update(organizationConfiguration)
                .set({
                  defaultAgentId: null,
                  lockVersion: sql`${organizationConfiguration.lockVersion} + 1`,
                })
                .where(
                  and(
                    eq(organizationConfiguration.organizationId, input.organizationId),
                    eq(organizationConfiguration.defaultAgentId, id),
                  ),
                )
              yield* deleteWithOptimisticLock({
                executor: transaction,
                table: agent,
                id,
                scope: eq(agent.organizationId, input.organizationId),
                expectedLockVersion: input.lockVersion,
              })
            }),
          )
        },
        mapDatabaseErrors(),
        Effect.catchTags({
          AgentNotFound: () => Effect.fail(new AgentChanged()),
          OptimisticLockError: () => Effect.fail(new AgentChanged()),
        }),
      )

      const setDefault = Effect.fn("Agents.setDefault")(
        function* (input: { organizationId: string; agentId: string }) {
          const id = yield* ownAgentId(input.organizationId, input.agentId)
          yield* db
            .insert(organizationConfiguration)
            .values({ organizationId: input.organizationId, defaultAgentId: id })
            .onConflictDoUpdate({
              target: organizationConfiguration.organizationId,
              set: {
                defaultAgentId: id,
                lockVersion: sql`${organizationConfiguration.lockVersion} + 1`,
                // Drizzle's `updatedAt` hook runs for update statements, not for a conflict clause.
                updatedAt: sql`now()`,
              },
            })
        },
        mapDatabaseErrors({
          organization_configuration_default_agent_id_fk: () => new AgentNotFound(),
        }),
      )

      const provisionDefault = Effect.fn("Agents.provisionDefault")(function* (input: {
        organizationId: string
        organizationName: string
        openaiApiKey?: string | undefined
      }) {
        return yield* db.transaction((transaction) =>
          Effect.gen(function* () {
            yield* transaction
              .insert(organizationConfiguration)
              .values({
                organizationId: input.organizationId,
                openaiApiKey: input.openaiApiKey
                  ? { organizationId: input.organizationId, apiKey: input.openaiApiKey }
                  : undefined,
              })
              .onConflictDoNothing()
            const [configuration] = yield* transaction
              .select({ defaultAgentId: organizationConfiguration.defaultAgentId })
              .from(organizationConfiguration)
              .where(eq(organizationConfiguration.organizationId, input.organizationId))
              .for("update")
            if (configuration?.defaultAgentId) return configuration.defaultAgentId
            const [existing] = yield* transaction
              .select({ id: agent.id })
              .from(agent)
              .where(eq(agent.organizationId, input.organizationId))
              .orderBy(agent.createdAt, agent.id)
              .limit(1)
            const [selected] = existing
              ? [existing]
              : yield* transaction
                  .insert(agent)
                  .values({
                    organizationId: input.organizationId,
                    name: defaultAgentName(input.organizationName),
                    systemPrompt: defaultAgentSystemPrompt(input.organizationName),
                  })
                  .returning({ id: agent.id })
            yield* transaction
              .update(organizationConfiguration)
              .set({
                defaultAgentId: selected!.id,
                lockVersion: sql`${organizationConfiguration.lockVersion} + 1`,
              })
              .where(eq(organizationConfiguration.organizationId, input.organizationId))
            return selected!.id
          }),
        )
      }, mapDatabaseErrors())

      return Agents.of({
        list,
        formOptions,
        get,
        create,
        update,
        remove,
        setDefault,
        provisionDefault,
      })
    }),
  )

  static readonly layer = Agents.layerNoDeps.pipe(Layer.provide(Database.layer))
}
