import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"

import { withTransaction } from "@/lib/persistence.server"
import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { agent, agentModel, organizationConfiguration } from "@/db/schema/organizations"
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
export type Agent = typeof agent.$inferSelect & { readonly modelIds: readonly string[] }

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

const decodeAgentRow = Schema.decodeUnknownEffect(agent.schema, { onExcessProperty: "error" })
const agentModelsSelection = {
  columns: { providerModelId: true },
  orderBy: { position: "asc" },
} as const

const mapAgentWriteErrors = mapDatabaseErrors({
  agent_model_provider_model_fk: () => new AgentModelInvalid(),
  agent_organization_id_name_uidx: () => new AgentNameTaken(),
  agent_organization_id_sandbox_provider_id_fk: () => new AgentSandboxProviderInvalid(),
})

/** Names the starter agent after its organization, within the limit the agent form enforces. */
function defaultAgentName(organizationName: string): string {
  const suffix = " Assistant"
  const name = organizationName
    .trim()
    .slice(0, 100 - suffix.length)
    .trimEnd()
  return `${name}${suffix}`.trimStart()
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
    const useDatabase = Effect.provideService(Database, db)
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
      organizationId: string
      fields: AgentFields
    }) {
      const { modelIds, ...fields } = input.fields
      return yield* withTransaction(
        Effect.gen(function* () {
          const created = yield* agent.insert({
            organizationId: input.organizationId,
            ...fields,
          })
          if (modelIds)
            yield* db.insert(agentModel).values(agentModelValues({ ...created, modelIds }))
          return formatAgentId(created)
        }),
      ).pipe(useDatabase, mapAgentWriteErrors)
    })

    const update = Effect.fn("Agents.update")(
      function* (input: VersionedAgentTarget & { readonly fields: AgentFields }) {
        const id = yield* ownAgentId(input.organizationId, input.agentId)
        const { modelIds, ...fields } = input.fields
        yield* withTransaction(
          Effect.gen(function* () {
            const { organizationId } = yield* agent.update({ ...input, id }, fields)
            if (modelIds) {
              yield* db
                .delete(agentModel)
                .where(
                  and(eq(agentModel.organizationId, organizationId), eq(agentModel.agentId, id)),
                )
              yield* db
                .insert(agentModel)
                .values(agentModelValues({ organizationId, id, modelIds }))
            }
          }),
        ).pipe(useDatabase, mapAgentWriteErrors)
      },
      Effect.catchTag(["AgentNotFound", "NotFound", "StaleWrite"], () => new AgentChanged()),
    )

    const remove = Effect.fn("Agents.remove")(
      function* (input: VersionedAgentTarget) {
        const { organizationId, agentId, lockVersion } = input
        const id = yield* ownAgentId(organizationId, agentId)
        yield* withTransaction(
          Effect.gen(function* () {
            // Clear the selection explicitly so the configuration's optimistic lock and timestamp advance too.
            yield* db
              .update(organizationConfiguration)
              .set({
                defaultAgentId: null,
                lockVersion: sql`${organizationConfiguration.lockVersion} + 1`,
              })
              .where(
                and(
                  eq(organizationConfiguration.organizationId, organizationId),
                  eq(organizationConfiguration.defaultAgentId, id),
                ),
              )
            yield* agent.delete({ organizationId, id, lockVersion })
          }),
        )
      },
      useDatabase,
      mapDatabaseErrors(),
      Effect.catchTag(["AgentNotFound", "NotFound", "StaleWrite"], () => new AgentChanged()),
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
      const { organizationId, organizationName, modelIds } = input
      return yield* db.transaction((transaction) =>
        Effect.gen(function* () {
          yield* transaction
            .insert(organizationConfiguration)
            .values({ organizationId })
            .onConflictDoNothing()
          const [configuration] = yield* transaction
            .select({ defaultAgentId: organizationConfiguration.defaultAgentId })
            .from(organizationConfiguration)
            .where(eq(organizationConfiguration.organizationId, organizationId))
            .for("update")
          if (configuration?.defaultAgentId) return configuration.defaultAgentId
          const [existing] = yield* transaction
            .select({ id: agent.id })
            .from(agent)
            .where(eq(agent.organizationId, organizationId))
            .orderBy(agent.createdAt, agent.id)
            .limit(1)
          const selected =
            existing ??
            (yield* agent
              .insert({
                organizationId,
                name: defaultAgentName(organizationName),
                systemPrompt: defaultAgentSystemPrompt(organizationName),
              })
              .pipe(useDatabase))
          if (!existing && modelIds?.length)
            yield* transaction
              .insert(agentModel)
              .values(agentModelValues({ organizationId, id: selected.id, modelIds }))
          yield* transaction
            .update(organizationConfiguration)
            .set({
              defaultAgentId: selected.id,
              lockVersion: sql`${organizationConfiguration.lockVersion} + 1`,
            })
            .where(eq(organizationConfiguration.organizationId, organizationId))
          return selected.id
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
