import { and, asc, eq, notInArray, sql } from "drizzle-orm"
import { Context, Effect, Layer, Result } from "effect"

import { Database } from "@/db/database.server"
import { Config } from "@/lib/config/config.server"
import { getDatabaseEncryptionKeyring } from "@/db/lib/database-credentials.server"
import { decryptDatabaseValue } from "@/db/lib/encryption.server"
import {
  deleteWithOptimisticLock,
  updateWithOptimisticLock,
} from "@/db/lib/optimistic-locking.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import { DatabaseRateLimiter, hashedRateLimitKey } from "@/db/lib/rate-limiter.server"
import {
  agent,
  agentModel,
  modelProvider,
  organizationConfiguration,
  providerModel,
} from "@/db/schema/organizations.server"
import { fetchPublicModelEndpoint, isPublicModelEndpointUrl } from "./endpoints.server.ts"
import { formatAgentId } from "../agents/schemas.ts"
import {
  ModelProviderChanged,
  ModelProviderEndpointNotAllowed,
  ModelProviderInUse,
  ModelProviderKeyMissing,
  ModelProviderNameTaken,
  ModelProviderUnreadable,
  ModelProviderTestFailed,
  ModelProviderTestRateLimited,
  ModelUsageConfigurationMissing,
} from "./errors.ts"
import {
  effectiveModelUsageConfiguration,
  readModelPriceCatalog,
} from "./pricing-catalog.server.ts"
import type { ModelUsageConfiguration } from "./usage-schemas.ts"
import { testProviderModel } from "./test-model.server.ts"
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
  readonly usageConfiguration: ModelUsageConfiguration | null
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

export type ModelProviderListItem = Omit<OrganizationModelProvider, "apiKeyHint" | "organizationId">

export interface ModelChoice extends Omit<ModelProviderModel, "usageConfiguration"> {
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
  /** Enforces the deployment's private endpoint policy on every provider request. */
  readonly fetch: typeof fetch
}

export type SaveModelProviderInput = ModelProviderFields & {
  readonly organizationId: string
  readonly id: string | null
  readonly lockVersion: number | null
}

type TestModelProviderInput = {
  readonly organizationId: string
  readonly id: string
  readonly lockVersion: number
  readonly modelId: string
}

type ModelProviderWriteError =
  | ModelProviderChanged
  | ModelProviderEndpointNotAllowed
  | ModelProviderInUse
  | ModelProviderNameTaken
  | ModelProviderKeyMissing
  | ModelProviderUnreadable
  | ModelUsageConfigurationMissing

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
    }) => Effect.Effect<readonly ModelProviderListItem[]>
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
      readonly defaultAgentModelCount: number
      readonly defaultAgentId: string | null
    }>
    readonly resolveForAgent: (input: {
      readonly organizationId: string
      readonly agentId: string
    }) => Effect.Effect<ChatModelConfiguration | null, ModelProviderUnreadable>
    readonly testModel: (
      input: TestModelProviderInput,
    ) => Effect.Effect<
      void,
      | ModelProviderChanged
      | ModelProviderUnreadable
      | ModelProviderTestFailed
      | ModelProviderTestRateLimited
    >
  }
>()("astralbeam/model-providers/ModelProviders") {
  static readonly layerNoDeps = Layer.effect(
    ModelProviders,
    Effect.gen(function* () {
      const db = yield* Database
      const config = yield* Config
      const rateLimiter = yield* DatabaseRateLimiter
      const readPricing = readModelPriceCatalog.pipe(Effect.provideService(Config, config))
      const allowsPrivateEndpoints = Effect.map(
        config.get("allow_private_model_endpoints"),
        (value) => value === "true",
      )

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

      // Names the agents still assigned a provider's models, other than those kept by a save.
      const failInUse = Effect.fnUntraced(function* (
        organizationId: string,
        modelProviderId: string,
        keptModelIds: string[],
      ) {
        const agents = yield* db
          .selectDistinct({ name: agent.name })
          .from(agentModel)
          .innerJoin(
            providerModel,
            and(
              eq(agentModel.organizationId, providerModel.organizationId),
              eq(agentModel.providerModelId, providerModel.id),
            ),
          )
          .innerJoin(
            agent,
            and(
              eq(agentModel.organizationId, agent.organizationId),
              eq(agentModel.agentId, agent.id),
            ),
          )
          .where(
            and(
              eq(agentModel.organizationId, organizationId),
              eq(providerModel.modelProviderId, modelProviderId),
              keptModelIds.length > 0 ? notInArray(providerModel.modelId, keptModelIds) : undefined,
            ),
          )
          .orderBy(asc(agent.name))
          .pipe(Effect.orDie)
        return yield* new ModelProviderInUse({
          agentNames: agents.slice(0, 3).map(({ name }) => name),
          agentCount: agents.length,
        })
      })

      const list = Effect.fn("ModelProviders.list")(function* (input: { organizationId: string }) {
        const catalog = yield* readPricing
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
        return rows.map(({ storedCredentials, organizationId, ...row }) => {
          const apiKey = readModelProviderKey({ ...row, organizationId, storedCredentials })
          return {
            ...row,
            credentialsReadable: apiKey !== null,
            models: models
              .filter((model) => model.modelProviderId === row.id)
              .map(({ id, modelId, name, usageConfiguration }) => ({
                id,
                modelId,
                name,
                usageConfiguration: effectiveModelUsageConfiguration({
                  catalog,
                  providerType: row.providerType,
                  modelId,
                  configured: usageConfiguration,
                }),
              })),
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
        const catalog = yield* readPricing
        const apiKey = readModelProviderKey(stored)
        const models = yield* db
          .select({
            id: providerModel.id,
            modelId: providerModel.modelId,
            name: providerModel.name,
            usageConfiguration: providerModel.usageConfiguration,
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
          models: models.map((model) => ({
            ...model,
            usageConfiguration: effectiveModelUsageConfiguration({
              catalog,
              providerType: row.providerType,
              modelId: model.modelId,
              configured: model.usageConfiguration,
            }),
          })),
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
        if (!(yield* allowsPrivateEndpoints) && !isPublicModelEndpointUrl(new URL(input.baseUrl)))
          return yield* new ModelProviderEndpointNotAllowed()
        // A stored key never follows its connection to another URL or provider type.
        const keyKept =
          existing?.baseUrl === input.baseUrl && existing.providerType === input.providerType
        const apiKey = input.apiKey ?? (keyKept ? readModelProviderKey(existing) : null)
        if (!apiKey)
          return yield* keyKept ? new ModelProviderUnreadable() : new ModelProviderKeyMissing()
        const catalog = yield* readPricing
        const configuredModels = input.models.map((model) => ({
          ...model,
          usageConfiguration: effectiveModelUsageConfiguration({
            catalog,
            providerType: input.providerType,
            modelId: model.modelId,
            configured: model.usageConfiguration,
          }),
        }))
        if (configuredModels.some((model) => model.usageConfiguration === null))
          return yield* new ModelUsageConfigurationMissing()
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
                    configuredModels.map((model) => ({
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
                    set: {
                      name: sql`excluded.name`,
                      usageConfiguration: sql`excluded.usage_configuration`,
                      updatedAt: sql`now()`,
                    },
                  })
              return id!
            }),
          )
          .pipe(
            mapModelProviderWriteErrors,
            Effect.catchTag("OptimisticLockError", () => Effect.fail(new ModelProviderChanged())),
            Effect.catchTag("ModelProviderInUse", () =>
              failInUse(
                input.organizationId,
                existing!.id,
                input.models.map((model) => model.modelId),
              ),
            ),
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
        (effect, input) =>
          Effect.catchTag(effect, "ModelProviderInUse", () =>
            failInUse(input.organizationId, input.id, []),
          ),
      )

      const setupState = Effect.fn("ModelProviders.setupState")(function* (input: {
        organizationId: string
      }) {
        const [providers, models, defaultAgentModels] = yield* Effect.all(
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
              .select({
                id: organizationConfiguration.defaultAgentId,
                count: sql<number>`count(${agentModel.agentId})::integer`,
              })
              .from(organizationConfiguration)
              .leftJoin(
                agentModel,
                and(
                  eq(organizationConfiguration.organizationId, agentModel.organizationId),
                  eq(organizationConfiguration.defaultAgentId, agentModel.agentId),
                ),
              )
              .where(eq(organizationConfiguration.organizationId, input.organizationId))
              .groupBy(organizationConfiguration.defaultAgentId),
          ],
          { concurrency: "unbounded" },
        )
        return {
          providerCount: providers[0]!.count,
          enabledModelCount: models[0]!.count,
          defaultAgentModelCount: defaultAgentModels[0]?.count ?? 0,
          defaultAgentId: defaultAgentModels[0]?.id
            ? formatAgentId({ organizationId: input.organizationId, id: defaultAgentModels[0].id })
            : null,
        }
      }, Effect.orDie)

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
        return {
          ...configuration,
          apiKey,
          fetch: (yield* allowsPrivateEndpoints) ? fetch : fetchPublicModelEndpoint,
        }
      })

      const testModel = Effect.fn("ModelProviders.testModel")(function* (
        input: TestModelProviderInput,
      ) {
        const provider = yield* readModelProviderRow(input.organizationId, input.id)
        if (provider?.lockVersion !== input.lockVersion) return yield* new ModelProviderChanged()
        const [model] = yield* db
          .select({ modelId: providerModel.modelId })
          .from(providerModel)
          .where(
            and(
              eq(providerModel.organizationId, input.organizationId),
              eq(providerModel.modelProviderId, input.id),
              eq(providerModel.id, input.modelId),
            ),
          )
          .limit(1)
          .pipe(Effect.orDie)
        if (!model) return yield* new ModelProviderChanged()
        const apiKey = readModelProviderKey(provider)
        if (!apiKey) return yield* new ModelProviderUnreadable()
        yield* rateLimiter
          .consume({
            key: hashedRateLimitKey("model-test", [input.organizationId]),
            limit: 5,
            window: "1 minute",
          })
          .pipe(
            Effect.catchReason(
              "RateLimiterError",
              "RateLimitExceeded",
              () => Effect.fail(new ModelProviderTestRateLimited()),
              (_reason, error) => Effect.die(error),
            ),
          )
        yield* testProviderModel({
          providerId: provider.id,
          providerName: provider.name,
          providerType: provider.providerType,
          api: provider.api,
          baseUrl: provider.baseUrl,
          modelId: model.modelId,
          apiKey,
          fetch: (yield* allowsPrivateEndpoints) ? fetch : fetchPublicModelEndpoint,
        })
        const current = yield* readModelProviderRow(input.organizationId, input.id)
        if (current?.lockVersion !== input.lockVersion) return yield* new ModelProviderChanged()
      })

      return ModelProviders.of({
        list,
        get,
        choices,
        save,
        remove,
        setupState,
        resolveForAgent,
        testModel,
      })
    }),
  )

  static readonly layer = ModelProviders.layerNoDeps.pipe(
    Layer.provide([Database.layer, Config.layer, DatabaseRateLimiter.layer]),
  )
}
