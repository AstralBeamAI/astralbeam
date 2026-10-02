import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm"
import { Context, Effect, Layer, Result } from "effect"

import { Database } from "@/db/database.server"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials.server"
import { decryptDatabaseValue } from "@/db/lib/encryption.server"
import {
  deleteWithOptimisticLock,
  updateWithOptimisticLock,
} from "@/db/lib/optimistic-locking.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import {
  agent,
  agentModel,
  modelProvider,
  organizationConfiguration,
  OrganizationOpenaiApiKeyPayloadSchema,
  providerModel,
} from "@/db/schema/organizations.server"
import {
  ModelProviderChanged,
  ModelProviderInUse,
  ModelProviderKeyMissing,
  ModelProviderNameTaken,
  ModelProviderUnreadable,
} from "./errors.ts"
import {
  ModelProviderCredentialsPayloadSchema,
  type ModelProviderFields,
  type ModelProviderApi,
  type ModelProviderType,
} from "./schemas.ts"

interface ModelProviderModel {
  readonly id: string
  readonly modelId: string
  readonly name: string
}

export interface OrganizationModelProvider {
  readonly id: string
  readonly organizationId: string
  readonly name: string
  readonly providerType: ModelProviderType
  readonly api: ModelProviderApi
  readonly baseUrl: string
  readonly lockVersion: number
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly apiKeyHint: string | null
  readonly credentialsReadable: boolean
  readonly models: readonly ModelProviderModel[]
}

export interface ModelChoice extends ModelProviderModel {
  readonly providerId: string
  readonly providerName: string
}

export interface ChatModelConfiguration {
  readonly providerId: string
  readonly providerName: string
  readonly providerType: ModelProviderType
  readonly api: ModelProviderApi
  readonly baseUrl: string
  readonly apiKey: string
  readonly modelId: string
}

export type SaveModelProviderInput = ModelProviderFields & {
  readonly organizationId: string
  readonly id: string | null
  readonly lockVersion: number | null
}

type ModelProviderWriteError =
  | ModelProviderChanged
  | ModelProviderInUse
  | ModelProviderNameTaken
  | ModelProviderKeyMissing
  | ModelProviderUnreadable

const modelProviderReadColumns = {
  id: modelProvider.id,
  organizationId: modelProvider.organizationId,
  name: modelProvider.name,
  providerType: modelProvider.providerType,
  api: modelProvider.api,
  baseUrl: modelProvider.baseUrl,
  lockVersion: modelProvider.lockVersion,
  createdAt: modelProvider.createdAt,
  updatedAt: modelProvider.updatedAt,
  storedCredentials: sql<string | null>`${modelProvider.credentials}::text`,
}

type StoredModelProvider = {
  readonly id: string
  readonly organizationId: string
  readonly providerType: ModelProviderType
  readonly storedCredentials: string | null
}

function readModelProviderKey(row: StoredModelProvider): string | null {
  const decoded = decryptDatabaseValue({
    storedValue: row.storedCredentials,
    schema: ModelProviderCredentialsPayloadSchema,
    keyring: getDatabaseEncryptionKeyring(),
  })
  if (Result.isFailure(decoded)) return null
  const payload = decoded.success.value
  return payload.organizationId === row.organizationId &&
    payload.modelProviderId === row.id &&
    payload.providerType === row.providerType
    ? payload.apiKey
    : null
}

const mapModelProviderWriteErrors = mapDatabaseErrors({
  model_provider_organization_id_name_uidx: () => new ModelProviderNameTaken(),
  agent_model_provider_model_fk: () => new ModelProviderInUse(),
})

export class ModelProviders extends Context.Service<
  ModelProviders,
  {
    readonly list: (input: {
      readonly organizationId: string
    }) => Effect.Effect<readonly OrganizationModelProvider[]>
    readonly get: (input: {
      readonly organizationId: string
      readonly id: string
    }) => Effect.Effect<OrganizationModelProvider | null>
    readonly choices: (input: {
      readonly organizationId: string
    }) => Effect.Effect<readonly ModelChoice[]>
    readonly save: (input: SaveModelProviderInput) => Effect.Effect<string, ModelProviderWriteError>
    readonly remove: (input: {
      readonly organizationId: string
      readonly id: string
      readonly lockVersion: number
    }) => Effect.Effect<void, ModelProviderChanged | ModelProviderInUse>
    readonly setupState: (input: { readonly organizationId: string }) => Effect.Effect<{
      readonly providerCount: number
      readonly enabledModelCount: number
      readonly readyAgentCount: number
    }>
    readonly importLegacy: (input: {
      readonly organizationId: string
    }) => Effect.Effect<string | null, ModelProviderNameTaken | ModelProviderUnreadable>
    readonly resolveForAgent: (input: {
      readonly organizationId: string
      readonly agentId: string
    }) => Effect.Effect<ChatModelConfiguration | null, ModelProviderUnreadable>
  }
>()("astralbeam/model-providers/ModelProviders") {
  static readonly layerNoDeps = Layer.effect(
    ModelProviders,
    Effect.gen(function* () {
      const db = yield* Database

      const readModelProviderRow = Effect.fnUntraced(function* (
        organizationId: string,
        id: string,
      ) {
        const [row] = yield* db
          .select(modelProviderReadColumns)
          .from(modelProvider)
          .where(and(eq(modelProvider.organizationId, organizationId), eq(modelProvider.id, id)))
          .limit(1)
        return row ?? null
      }, Effect.orDie)

      const list = Effect.fn("ModelProviders.list")(function* (input: { organizationId: string }) {
        const rows = yield* db
          .select(modelProviderReadColumns)
          .from(modelProvider)
          .where(eq(modelProvider.organizationId, input.organizationId))
          .orderBy(asc(modelProvider.name), asc(modelProvider.id))
        const models = yield* db
          .select()
          .from(providerModel)
          .where(eq(providerModel.organizationId, input.organizationId))
          .orderBy(asc(providerModel.name), asc(providerModel.id))
        return rows.map(({ storedCredentials, ...row }) => {
          const apiKey = readModelProviderKey({ ...row, storedCredentials })
          return {
            ...row,
            apiKeyHint: apiKey?.slice(-4) ?? null,
            credentialsReadable: apiKey !== null,
            models: models
              .filter((model) => model.modelProviderId === row.id)
              .map(({ id, modelId, name }) => ({ id, modelId, name })),
          }
        })
      }, Effect.orDie)

      const get = Effect.fn("ModelProviders.get")(function* (input: {
        organizationId: string
        id: string
      }) {
        const stored = yield* readModelProviderRow(input.organizationId, input.id)
        if (!stored) return null
        const { storedCredentials: _storedCredentials, ...row } = stored
        const apiKey = readModelProviderKey(stored)
        const models = yield* db
          .select({
            id: providerModel.id,
            modelId: providerModel.modelId,
            name: providerModel.name,
          })
          .from(providerModel)
          .where(
            and(
              eq(providerModel.organizationId, input.organizationId),
              eq(providerModel.modelProviderId, input.id),
            ),
          )
          .orderBy(asc(providerModel.name), asc(providerModel.id))
        return {
          ...row,
          apiKeyHint: apiKey?.slice(-4) ?? null,
          credentialsReadable: apiKey !== null,
          models,
        }
      }, Effect.orDie)

      const choices = Effect.fn("ModelProviders.choices")(function* (input: {
        organizationId: string
      }) {
        return yield* db
          .select({
            id: providerModel.id,
            modelId: providerModel.modelId,
            name: providerModel.name,
            providerId: modelProvider.id,
            providerName: modelProvider.name,
          })
          .from(providerModel)
          .innerJoin(
            modelProvider,
            and(
              eq(providerModel.organizationId, modelProvider.organizationId),
              eq(providerModel.modelProviderId, modelProvider.id),
            ),
          )
          .where(eq(providerModel.organizationId, input.organizationId))
          .orderBy(asc(modelProvider.name), asc(providerModel.name), asc(providerModel.id))
      }, Effect.orDie)

      const save = Effect.fn("ModelProviders.save")(function* (input: SaveModelProviderInput) {
        const existing =
          input.id === null ? null : yield* readModelProviderRow(input.organizationId, input.id)
        if (
          input.id === null
            ? input.lockVersion !== null
            : !existing || existing.lockVersion !== input.lockVersion
        )
          return yield* new ModelProviderChanged()
        // A stored key never follows its connection to another URL or provider type.
        const keyKept =
          existing?.baseUrl === input.baseUrl && existing.providerType === input.providerType
        const apiKey = input.apiKey ?? (keyKept ? readModelProviderKey(existing) : null)
        if (!apiKey)
          return yield* keyKept ? new ModelProviderUnreadable() : new ModelProviderKeyMissing()
        return yield* db
          .transaction((transaction) =>
            Effect.gen(function* () {
              let id = existing?.id
              const fields = {
                name: input.name,
                providerType: input.providerType,
                api: input.api,
                baseUrl: input.baseUrl,
              }
              if (existing) {
                yield* updateWithOptimisticLock({
                  executor: transaction,
                  table: modelProvider,
                  id: existing.id,
                  scope: eq(modelProvider.organizationId, input.organizationId),
                  expectedLockVersion: existing.lockVersion,
                  set: {
                    ...fields,
                    credentials: {
                      organizationId: input.organizationId,
                      modelProviderId: existing.id,
                      providerType: input.providerType,
                      apiKey,
                    },
                  },
                })
              } else {
                const [created] = yield* transaction
                  .insert(modelProvider)
                  .values({ organizationId: input.organizationId, ...fields })
                  .returning({ id: modelProvider.id })
                id = created!.id
                yield* transaction
                  .update(modelProvider)
                  .set({
                    credentials: {
                      organizationId: input.organizationId,
                      modelProviderId: id,
                      providerType: input.providerType,
                      apiKey,
                    },
                  })
                  .where(
                    and(
                      eq(modelProvider.organizationId, input.organizationId),
                      eq(modelProvider.id, id),
                    ),
                  )
              }
              const modelIds = input.models.map((model) => model.modelId)
              yield* transaction
                .delete(providerModel)
                .where(
                  and(
                    eq(providerModel.organizationId, input.organizationId),
                    eq(providerModel.modelProviderId, id!),
                    modelIds.length > 0 ? notInArray(providerModel.modelId, modelIds) : undefined,
                  ),
                )
              if (input.models.length > 0)
                yield* transaction
                  .insert(providerModel)
                  .values(
                    input.models.map((model) => ({
                      organizationId: input.organizationId,
                      modelProviderId: id!,
                      ...model,
                    })),
                  )
                  .onConflictDoUpdate({
                    target: [
                      providerModel.organizationId,
                      providerModel.modelProviderId,
                      providerModel.modelId,
                    ],
                    set: { name: sql`excluded.name`, updatedAt: sql`now()` },
                  })
              return id!
            }),
          )
          .pipe(
            mapModelProviderWriteErrors,
            Effect.catchTag("OptimisticLockError", () => Effect.fail(new ModelProviderChanged())),
          )
      })

      const remove = Effect.fn("ModelProviders.remove")(
        function* (input: { organizationId: string; id: string; lockVersion: number }) {
          yield* deleteWithOptimisticLock({
            executor: db,
            table: modelProvider,
            id: input.id,
            scope: eq(modelProvider.organizationId, input.organizationId),
            expectedLockVersion: input.lockVersion,
          })
        },
        mapDatabaseErrors({ agent_model_provider_model_fk: () => new ModelProviderInUse() }),
        Effect.catchTag("OptimisticLockError", () => Effect.fail(new ModelProviderChanged())),
      )

      const setupState = Effect.fn("ModelProviders.setupState")(function* (input: {
        organizationId: string
      }) {
        const [providers, models, agents] = yield* Effect.all(
          [
            db
              .select({ count: sql<number>`count(*)::integer` })
              .from(modelProvider)
              .where(eq(modelProvider.organizationId, input.organizationId)),
            db
              .select({ count: sql<number>`count(*)::integer` })
              .from(providerModel)
              .where(eq(providerModel.organizationId, input.organizationId)),
            db
              .select({ count: sql<number>`count(distinct ${agentModel.agentId})::integer` })
              .from(agentModel)
              .where(eq(agentModel.organizationId, input.organizationId)),
          ],
          { concurrency: "unbounded" },
        )
        return {
          providerCount: providers[0]!.count,
          enabledModelCount: models[0]!.count,
          readyAgentCount: agents[0]!.count,
        }
      }, Effect.orDie)

      const importLegacy = Effect.fn("ModelProviders.importLegacy")(function* (input: {
        organizationId: string
      }) {
        return yield* db
          .transaction((transaction) =>
            Effect.gen(function* () {
              const [legacy] = yield* transaction
                .select({
                  storedValue: sql<string | null>`${organizationConfiguration.openaiApiKey}::text`,
                })
                .from(organizationConfiguration)
                .where(eq(organizationConfiguration.organizationId, input.organizationId))
                .for("update")
              if (!legacy?.storedValue) return null
              const decoded = decryptDatabaseValue({
                storedValue: legacy.storedValue,
                schema: OrganizationOpenaiApiKeyPayloadSchema,
                keyring: getDatabaseEncryptionKeyring(),
              })
              if (
                Result.isFailure(decoded) ||
                decoded.success.value.organizationId !== input.organizationId
              )
                return yield* new ModelProviderUnreadable()
              const [created] = yield* transaction
                .insert(modelProvider)
                .values({
                  organizationId: input.organizationId,
                  name: "Imported OpenAI",
                  providerType: "openai",
                  api: "responses",
                  baseUrl: "https://api.openai.com/v1",
                })
                .returning({ id: modelProvider.id })
              const id = created!.id
              yield* transaction
                .update(modelProvider)
                .set({
                  credentials: {
                    organizationId: input.organizationId,
                    modelProviderId: id,
                    providerType: "openai",
                    apiKey: decoded.success.value.apiKey,
                  },
                })
                .where(
                  and(
                    eq(modelProvider.organizationId, input.organizationId),
                    eq(modelProvider.id, id),
                  ),
                )
              const [model] = yield* transaction
                .insert(providerModel)
                .values({
                  organizationId: input.organizationId,
                  modelProviderId: id,
                  modelId: "gpt-5.6-terra",
                  name: "gpt-5.6-terra",
                })
                .returning({ id: providerModel.id })
              // Lock agent edits first, then read assignments with a fresh statement snapshot.
              const agents = yield* transaction
                .select({ id: agent.id })
                .from(agent)
                .where(eq(agent.organizationId, input.organizationId))
                .for("update")
              const assigned = yield* transaction
                .select({ agentId: agentModel.agentId })
                .from(agentModel)
                .where(eq(agentModel.organizationId, input.organizationId))
              const assignedIds = new Set(assigned.map((row) => row.agentId))
              const unassigned = agents.filter((row) => !assignedIds.has(row.id))
              if (unassigned.length > 0) {
                yield* transaction.insert(agentModel).values(
                  unassigned.map((row) => ({
                    organizationId: input.organizationId,
                    agentId: row.id,
                    providerModelId: model!.id,
                    position: 0,
                  })),
                )
                yield* transaction
                  .update(agent)
                  .set({ lockVersion: sql`${agent.lockVersion} + 1` })
                  .where(
                    and(
                      eq(agent.organizationId, input.organizationId),
                      inArray(
                        agent.id,
                        unassigned.map((row) => row.id),
                      ),
                    ),
                  )
              }
              yield* transaction
                .update(organizationConfiguration)
                .set({
                  openaiApiKey: null,
                  lockVersion: sql`${organizationConfiguration.lockVersion} + 1`,
                })
                .where(eq(organizationConfiguration.organizationId, input.organizationId))
              return id
            }),
          )
          .pipe(
            mapDatabaseErrors({
              model_provider_organization_id_name_uidx: () => new ModelProviderNameTaken(),
            }),
          )
      })

      const resolveForAgent = Effect.fn("ModelProviders.resolveForAgent")(function* (input: {
        organizationId: string
        agentId: string
      }) {
        const [selected] = yield* db
          .select({
            providerId: modelProvider.id,
            providerName: modelProvider.name,
            providerType: modelProvider.providerType,
            api: modelProvider.api,
            baseUrl: modelProvider.baseUrl,
            modelId: providerModel.modelId,
            storedCredentials: sql<string | null>`${modelProvider.credentials}::text`,
          })
          .from(agentModel)
          .innerJoin(
            providerModel,
            and(
              eq(agentModel.organizationId, providerModel.organizationId),
              eq(agentModel.providerModelId, providerModel.id),
            ),
          )
          .innerJoin(
            modelProvider,
            and(
              eq(providerModel.organizationId, modelProvider.organizationId),
              eq(providerModel.modelProviderId, modelProvider.id),
            ),
          )
          .where(
            and(
              eq(agentModel.organizationId, input.organizationId),
              eq(agentModel.agentId, input.agentId),
            ),
          )
          .orderBy(asc(agentModel.position))
          .limit(1)
          .pipe(Effect.orDie)
        if (!selected) return null
        const { storedCredentials, ...configuration } = selected
        const apiKey = readModelProviderKey({
          id: selected.providerId,
          organizationId: input.organizationId,
          providerType: selected.providerType,
          storedCredentials,
        })
        if (!apiKey) {
          yield* Effect.logWarning("Model provider key could not be read").pipe(
            Effect.annotateLogs({
              organizationId: input.organizationId,
              providerId: selected.providerId,
            }),
          )
          return yield* new ModelProviderUnreadable()
        }
        return { ...configuration, apiKey }
      })

      return ModelProviders.of({
        list,
        get,
        choices,
        save,
        remove,
        setupState,
        importLegacy,
        resolveForAgent,
      })
    }),
  )

  static readonly layer = ModelProviders.layerNoDeps.pipe(Layer.provide(Database.layer))
}
