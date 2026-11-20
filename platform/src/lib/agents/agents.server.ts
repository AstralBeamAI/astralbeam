import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"

import { Database } from "@/db/database"
import { deleteWithOptimisticLock, updateWithOptimisticLock } from "@/db/lib/optimistic-locking"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import {
  agent,
  agentModel,
  AgentRowSchema,
  organizationConfiguration,
} from "@/db/schema/organizations"
import { SandboxProviderIdSchema, SandboxProviderNameSchema } from "@/lib/sandboxes/schemas"
import { getAvailableSandboxProviderIds } from "@/lib/sandboxes/availability.server"
import { ModelProviders } from "@/lib/model-providers/model-providers.server"
import { UuidV7Schema } from "@/lib/schemas"
import {
  AgentChanged,
  AgentModelInvalid,
  AgentNameTaken,
  AgentNotFound,
  AgentSandboxProviderInvalid,
} from "./errors.ts"
import { type AgentFields, formatAgentId, parseAgentId } from "./schemas.ts"

/** An agent as the dashboard sees it, addressed by its public ID. */
export type Agent = typeof AgentRowSchema.Type & { readonly modelIds: readonly string[] }

type AgentTarget = {
  readonly organizationId: string
  readonly agentId: string
}

type VersionedAgentTarget = AgentTarget & { readonly lockVersion: number }

const agentModelValues = ({
  organizationId,
  id,
  modelIds,
}: Pick<Agent, "organizationId" | "id" | "modelIds">) =>
  modelIds.map((providerModelId, position) => ({
    organizationId,
    agentId: id,
    providerModelId,
    position,
  }))

const AgentSandboxProviderSchema = Schema.Struct({
  id: UuidV7Schema,
  name: SandboxProviderNameSchema,
  providerType: SandboxProviderIdSchema,
})

export type AgentSandboxProvider = typeof AgentSandboxProviderSchema.Type & {
  readonly available: boolean
}

/** The agent policy a chat run reads before resolving its selected model. */
export type ChatAgent = Readonly<
  Pick<
    typeof agent.$inferSelect,
    "id" | "systemPrompt" | "attachmentsEnabled" | "webAccessEnabled" | "sandboxProviderId"
  >
>

const DefaultAgentConfigurationSchema = Schema.NullOr(
  Schema.Struct({ defaultAgentId: Schema.NullOr(UuidV7Schema) }),
)

const decodeDefaultAgentConfiguration = Schema.decodeUnknownEffect(
  DefaultAgentConfigurationSchema,
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

const agentModelsSelection = {
  columns: { providerModelId: true },
  orderBy: { position: "asc" },
} as const

const mapAgentWriteErrors = mapDatabaseErrors({
  agent_model_provider_model_fk: () => new AgentModelInvalid(),
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

/** Starter persona. The chat endpoint always prepends its own product-neutral system prompt. */
function defaultAgentSystemPrompt(organizationName: string): string {
  return (
    `You are the assistant for ${organizationName.trim()}. Help its users with their ` +
    "questions and tasks inside the application you are embedded in, acting through the tools " +
    "and widgets that application declares. Ask one short clarifying question when a request " +
    "is ambiguous, and say plainly when something is outside what you can do."
  )
}

function publicAgent({
  models,
  ...row
}: typeof agent.$inferSelect & { readonly models: readonly { providerModelId: string }[] }) {
  return decodeAgentRow(row).pipe(
    Effect.map((decoded): Agent => ({
      ...decoded,
      id: formatAgentId(decoded),
      modelIds: models.map((model) => model.providerModelId),
    })),
  )
}

function publicDefaultAgentId(
  organizationId: string,
  configuration: typeof DefaultAgentConfigurationSchema.Type,
): string | null {
  const id = configuration?.defaultAgentId
  return id ? formatAgentId({ organizationId, id }) : null
}

/** Resolves a public agent ID to its row ID, failing alike for malformed and foreign IDs. */
const ownAgentId = Effect.fnUntraced(function* (organizationId: string, agentId: unknown) {
  const parsed = parseAgentId(agentId)
  if (parsed?.organizationId !== organizationId) return yield* new AgentNotFound()
  return parsed.id
})

export class Agents extends Context.Service<Agents>()("astralbeam/agents/Agents", {
  make: Effect.gen(function* () {
    const db = yield* Database
    const modelProviders = yield* ModelProviders

    const list = Effect.fn("Agents.list")(function* (organizationId: string) {
      const organization = yield* db.query.organization.findFirst({
        columns: {},
        where: { id: organizationId },
        with: {
          agents: {
            orderBy: { name: "asc", id: "asc" },
            with: { models: agentModelsSelection },
          },
          configuration: { columns: { defaultAgentId: true } },
        },
      })
      const configuration = yield* decodeDefaultAgentConfiguration(organization?.configuration)
      return {
        agents: yield* Effect.forEach(organization?.agents ?? [], publicAgent),
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
      const availableProviders = yield* Effect.promise(getAvailableSandboxProviderIds)
      return {
        sandboxProviders: sandboxProviders.map((provider) => ({
          ...provider,
          available: availableProviders.includes(provider.providerType),
        })),
        models: yield* modelProviders.choices({ organizationId }),
        defaultAgentId: publicDefaultAgentId(organizationId, configuration),
      }
    }, Effect.orDie)

    const get = Effect.fn("Agents.get")(function* (input: AgentTarget) {
      const id = yield* ownAgentId(input.organizationId, input.agentId)
      const row = yield* db.query.agent
        .findFirst({
          where: { organizationId: input.organizationId, id },
          with: { models: agentModelsSelection },
        })
        .pipe(Effect.orDie)
      if (!row) return yield* new AgentNotFound()
      return yield* publicAgent(row).pipe(Effect.orDie)
    })

    const create = Effect.fn("Agents.create")(function* (input: {
      readonly organizationId: string
      readonly fields: AgentFields
    }) {
      const { modelIds, ...fields } = input.fields
      return yield* db
        .transaction((transaction) =>
          Effect.gen(function* () {
            const [created] = yield* transaction
              .insert(agent)
              .values({ organizationId: input.organizationId, ...fields })
              .returning({ id: agent.id })
            if (modelIds)
              yield* transaction.insert(agentModel).values(
                agentModelValues({
                  organizationId: input.organizationId,
                  id: created!.id,
                  modelIds,
                }),
              )
            return formatAgentId({ organizationId: input.organizationId, id: created!.id })
          }),
        )
        .pipe(mapAgentWriteErrors)
    })

    const update = Effect.fn("Agents.update")(
      function* (input: VersionedAgentTarget & { readonly fields: AgentFields }) {
        const id = yield* ownAgentId(input.organizationId, input.agentId)
        const { modelIds, ...fields } = input.fields
        yield* db
          .transaction((transaction) =>
            Effect.gen(function* () {
              yield* updateWithOptimisticLock({
                executor: transaction,
                table: agent,
                id,
                scope: eq(agent.organizationId, input.organizationId),
                expectedLockVersion: input.lockVersion,
                set: fields,
              })
              if (modelIds) {
                yield* transaction
                  .delete(agentModel)
                  .where(
                    and(
                      eq(agentModel.organizationId, input.organizationId),
                      eq(agentModel.agentId, id),
                    ),
                  )
                yield* transaction
                  .insert(agentModel)
                  .values(agentModelValues({ organizationId: input.organizationId, id, modelIds }))
              }
            }),
          )
          .pipe(mapAgentWriteErrors)
      },
      Effect.catchTags({
        AgentNotFound: () => Effect.fail(new AgentChanged()),
        OptimisticLockError: () => Effect.fail(new AgentChanged()),
      }),
    )

    const remove = Effect.fn("Agents.remove")(
      function* (input: VersionedAgentTarget) {
        const id = yield* ownAgentId(input.organizationId, input.agentId)
        yield* db.transaction((transaction) =>
          Effect.gen(function* () {
            // Clear the selection explicitly so the configuration's optimistic lock and timestamp advance too.
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
      function* (input: AgentTarget) {
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

    /**
     * Chat's one agent lookup: the public ID, or the organization's default when the host sends
     * none. Malformed and foreign IDs fail alike, so a caller cannot tell them apart.
     */
    const resolveForChat = Effect.fn("Agents.resolveForChat")(function* (input: {
      readonly organizationId: string
      readonly agentId: unknown
    }) {
      const id =
        input.agentId === null || input.agentId === undefined
          ? null
          : yield* ownAgentId(input.organizationId, input.agentId)
      const query = db
        .select({
          id: agent.id,
          systemPrompt: agent.systemPrompt,
          attachmentsEnabled: agent.attachmentsEnabled,
          webAccessEnabled: agent.webAccessEnabled,
          sandboxProviderId: agent.sandboxProviderId,
        })
        .from(agent)
      const [row] = yield* (
        id !== null
          ? query.where(and(eq(agent.id, id), eq(agent.organizationId, input.organizationId)))
          : query
              .innerJoin(
                organizationConfiguration,
                and(
                  eq(agent.id, organizationConfiguration.defaultAgentId),
                  eq(agent.organizationId, organizationConfiguration.organizationId),
                ),
              )
              .where(eq(agent.organizationId, input.organizationId))
      )
        .limit(1)
        .pipe(Effect.orDie)
      if (!row) return yield* new AgentNotFound()
      return row
    })

    /**
     * Recovers a missing default agent without replacing one or creating duplicates. Only a newly
     * created agent receives `modelIds`.
     */
    const provisionDefault = Effect.fn("Agents.provisionDefault")(function* (input: {
      readonly organizationId: string
      readonly organizationName: string
      readonly modelIds?: readonly string[]
    }) {
      return yield* db.transaction((transaction) =>
        Effect.gen(function* () {
          yield* transaction
            .insert(organizationConfiguration)
            .values({
              organizationId: input.organizationId,
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
          if (!existing && input.modelIds?.length)
            yield* transaction.insert(agentModel).values(
              agentModelValues({
                organizationId: input.organizationId,
                id: selected!.id,
                modelIds: input.modelIds,
              }),
            )
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

    return {
      list,
      formOptions,
      get,
      create,
      update,
      remove,
      setDefault,
      resolveForChat,
      provisionDefault,
    }
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make)

  static readonly layer = Agents.layerNoDeps.pipe(
    Layer.provide([Database.layer, ModelProviders.layer]),
  )
}
